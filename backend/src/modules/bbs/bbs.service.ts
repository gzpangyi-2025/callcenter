import { Injectable, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import { Post } from '../../entities/post.entity';
import { PostComment } from '../../entities/post-comment.entity';
import { BbsSection } from '../../entities/bbs-section.entity';
import { BbsTag } from '../../entities/bbs-tag.entity';
import { BbsSubscription } from '../../entities/bbs-subscription.entity';
import { SearchService } from '../search/search.service';
import { ChatGateway } from '../chat/chat.gateway';

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class BbsService implements OnModuleInit {
  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(PostComment)
    private readonly commentRepository: Repository<PostComment>,
    @InjectRepository(BbsSection)
    private readonly sectionRepository: Repository<BbsSection>,
    @InjectRepository(BbsTag)
    private readonly tagRepository: Repository<BbsTag>,
    @InjectRepository(BbsSubscription)
    private readonly subRepository: Repository<BbsSubscription>,
    private readonly searchService: SearchService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly chatGateway: ChatGateway,
  ) {}

  // ───────── Seed 默认板块 ─────────
  async onModuleInit() {
    const count = await this.sectionRepository.count();
    if (count === 0) {
      const defaults = [
        { name: '技术分享', icon: '💻', description: '技术探讨与经验分享', sortOrder: 1 },
        { name: 'Bug反馈', icon: '🐛', description: '系统Bug与问题反馈', sortOrder: 2 },
        { name: '新功能建议', icon: '💡', description: '功能需求与改进建议', sortOrder: 3 },
        { name: '日常闲聊', icon: '☕', description: '轻松聊天与生活分享', sortOrder: 4 },
        { name: '经验总结', icon: '📝', description: '工作经验与心得归档', sortOrder: 5 },
      ];
      await this.sectionRepository.save(defaults.map(d => this.sectionRepository.create(d)));
    }
  }

  // ───────── 板块 CRUD ─────────
  async findAllSections() {
    return this.sectionRepository.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async createSection(data: Partial<BbsSection>) {
    const section = this.sectionRepository.create(data);
    return this.sectionRepository.save(section);
  }

  async generateShareToken(id: number): Promise<string> {
    const post = await this.postRepository.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('帖子不存在');
    }
    const payload = {
      bbsId: id,
      role: 'external_bbs',
    };
    return this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '7d',
    });
  }

  async updateSection(id: number, data: Partial<BbsSection>) {
    const section = await this.sectionRepository.findOne({ where: { id } });
    if (!section) throw new NotFoundException('板块不存在');
    Object.assign(section, data);
    return this.sectionRepository.save(section);
  }

  async removeSection(id: number) {
    const section = await this.sectionRepository.findOne({ where: { id } });
    if (!section) throw new NotFoundException('板块不存在');
    // 将该板块下的帖子 sectionId 置空
    await this.postRepository.createQueryBuilder()
      .update(Post)
      .set({ sectionId: null as any })
      .where('sectionId = :id', { id })
      .execute();
      
    // 同步更新受影响的帖子到 ES (因为所属板块变为空了)
    const affectedPosts = await this.postRepository.find({ where: { sectionId: null as any }, relations: ['section', 'author'] });
    for (const p of affectedPosts) {
      this.searchService.indexPost(p).catch(() => {});
    }

    await this.sectionRepository.remove(section);
    return { success: true };
  }

  // ───────── 预设标签 CRUD ─────────
  async findAllTags() {
    return this.tagRepository.find({ order: { id: 'ASC' } });
  }

  async createTag(data: Partial<BbsTag>) {
    const tag = this.tagRepository.create(data);
    return this.tagRepository.save(tag);
  }

  async removeTag(id: number) {
    const tag = await this.tagRepository.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');
    await this.tagRepository.remove(tag);
    return { success: true };
  }

  // ───────── 帖子列表（支持板块筛选 + 全文搜索） ─────────
  async findAll(
    page = 1,
    pageSize = 20,
    tag?: string,
    search?: string,
    sortBy?: string,
    status?: string,
    sectionId?: number,
  ) {
    const qb = this.postRepository.createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('post.section', 'section');

    // 状态筛选
    if (status === 'archived') {
      qb.andWhere('post.isArchived = :archived', { archived: true });
    } else if (status === 'active' || !status) {
      qb.andWhere('post.isArchived = :archived', { archived: false });
    }

    // 板块筛选
    if (sectionId) {
      qb.andWhere('post.sectionId = :sectionId', { sectionId });
    }

    // 全文搜索：标题 + 正文
    if (search) {
      qb.andWhere('(post.title LIKE :search)', { search: `%${search}%` });
    }
    
    // 标签过滤
    if (tag) {
      qb.andWhere('JSON_CONTAINS(post.tags, :tag)', { tag: `"${tag}"` });
    }

    // 排序：置顶帖始终排在最前
    qb.addOrderBy('post.isPinned', 'DESC');

    if (sortBy === 'viewCount') {
      qb.addOrderBy('post.viewCount', 'DESC');
    } else if (sortBy === 'latestPost') {
      qb.addOrderBy('post.createdAt', 'DESC');
    } else {
      // 默认/最新回复排序：使用 COALESCE(lastCommentAt, createdAt) 来让新评论的帖子被顶起
      qb.addSelect('COALESCE(post.lastCommentAt, post.createdAt)', 'virtual_lastCommentAt');
      qb.addOrderBy('virtual_lastCommentAt', 'DESC');
    }

    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    // 同时统计回复数
    const itemsWithComments = await Promise.all(items.map(async item => {
      const commentCount = await this.commentRepository.count({ where: { postId: item.id } });
      return { ...item, commentCount };
    }));

    return { items: itemsWithComments, total };
  }

  async findOne(id: number) {
    const post = await this.postRepository.findOne({
      where: { id },
      relations: ['author', 'section'],
    });
    if (!post) throw new NotFoundException('帖子不存在');
    return post;
  }

  async create(data: Partial<Post>, authorId: number) {
    const post = this.postRepository.create({ ...data, authorId, viewCount: 0 });
    const saved = await this.postRepository.save(post);
    // 默认发布者关注该贴
    await this.subRepository.save(this.subRepository.create({ userId: authorId, postId: saved.id, unreadCount: 0 }));
    // 从 DB 加载带关联的完整实体同步到 ES
    this.findOne(saved.id).then(fullPost => this.searchService.indexPost(fullPost)).catch(() => {});
    return saved;
  }

  async update(id: number, data: Partial<Post>, userId: number, isAdmin: boolean) {
    const post = await this.findOne(id);
    if (post.authorId !== userId && !isAdmin) {
      throw new ForbiddenException('无权编辑该帖');
    }
    if (data.title !== undefined) post.title = data.title;
    if (data.content !== undefined) post.content = data.content;
    if (data.tags !== undefined) post.tags = data.tags;
    if (data.sectionId !== undefined) post.sectionId = data.sectionId;
    const saved = await this.postRepository.save(post);
    this.findOne(saved.id).then(fullPost => this.searchService.indexPost(fullPost)).catch(() => {});
    return saved;
  }

  async remove(id: number, userId: number, isAdmin: boolean) {
    const post = await this.findOne(id);
    if (post.authorId !== userId && !isAdmin) {
      throw new ForbiddenException('无权删除该帖');
    }
    await this.postRepository.remove(post);
    this.searchService.removePost(id).catch(() => {});
    return { success: true };
  }

  async batchRemove(ids: number[], userId: number, isAdmin: boolean) {
    const posts = await this.postRepository.createQueryBuilder('post')
      .where('post.id IN (:...ids)', { ids })
      .getMany();
    const postsToDelete = posts.filter(post => post.authorId === userId || isAdmin);
    if (postsToDelete.length > 0) {
      await this.postRepository.remove(postsToDelete);
      postsToDelete.forEach(p => this.searchService.removePost(p.id).catch(() => {}));
    }
    return { success: true, deletedCount: postsToDelete.length };
  }

  // ───────── 帖子迁移（单个/批量） ─────────
  async migrateToSection(ids: number[], targetSectionId: number) {
    // 验证目标板块存在
    const section = await this.sectionRepository.findOne({ where: { id: targetSectionId } });
    if (!section) throw new NotFoundException('目标板块不存在');
    
    await this.postRepository.createQueryBuilder()
      .update(Post)
      .set({ sectionId: targetSectionId })
      .where('id IN (:...ids)', { ids })
      .execute();
      
    // ES 同步
    const updatedPosts = await this.postRepository.find({ where: { id: In(ids) }, relations: ['section', 'author'] });
    updatedPosts.forEach(p => this.searchService.indexPost(p).catch(() => {}));
    
    return { success: true, migratedCount: ids.length, targetSection: section.name };
  }

  async togglePin(id: number) {
    const post = await this.findOne(id);
    post.isPinned = !post.isPinned;
    await this.postRepository.save(post);
    return { success: true, isPinned: post.isPinned };
  }

  async archive(id: number) {
    const post = await this.findOne(id);
    post.isArchived = true;
    post.isPinned = false;
    await this.postRepository.save(post);
    return { success: true };
  }

  async incrementView(id: number) {
    await this.postRepository.increment({ id }, 'viewCount', 1);
    return { success: true };
  }

  async getComments(postId: number) {
    return this.commentRepository.find({
      where: { postId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
  }

  async addComment(postId: number, content: string, authorId: number) {
    const comment = this.commentRepository.create({ postId, content, authorId });
    const savedComment = await this.commentRepository.save(comment);

    // 同步更新提贴的最新活跃时间，做到顶帖效果
    await this.postRepository.update(postId, { lastCommentAt: new Date() });

    // 处理订阅通知：找出所有订阅者（除了评论人自己）红点+1
    await this.subRepository.createQueryBuilder()
      .update(BbsSubscription)
      .set({ unreadCount: () => 'unreadCount + 1' })
      .where('postId = :postId AND userId != :authorId', { postId, authorId })
      .execute();

    // 取出刚才更新的通知列表，给他们推 Socket
    const subs = await this.subRepository.find({ where: { postId } });
    for (const sub of subs) {
      if (sub.userId !== authorId) {
        this.chatGateway.server.to(`user_${sub.userId}`).emit('bbsNewNotification', {
          postId,
          unreadCount: sub.unreadCount
        });
      }
    }

    return savedComment;
  }

  // ───────── 订阅 / 通知 ─────────
  async subscribe(postId: number, userId: number) {
    const existing = await this.subRepository.findOne({ where: { postId, userId } });
    if (!existing) {
      await this.subRepository.save(this.subRepository.create({ postId, userId, unreadCount: 0 }));
    }
    return { success: true, isSubscribed: true };
  }

  async unsubscribe(postId: number, userId: number) {
    await this.subRepository.delete({ postId, userId });
    return { success: true, isSubscribed: false };
  }

  async getSubscriptionStatus(postId: number, userId: number) {
    const sub = await this.subRepository.findOne({ where: { postId, userId } });
    return { isSubscribed: !!sub };
  }

  async getUnreadNotifications(userId: number) {
    return this.subRepository.find({
      where: { userId, unreadCount: MoreThan(0) },
      relations: ['post'],
      order: { createdAt: 'DESC' } // 这里其实 createdAt 是订阅时间，应根据 updatedAt，或最后拉取即可。可以根据实际需求加 updatedAt
    });
  }

  async clearUnread(postId: number, userId: number) {
    const sub = await this.subRepository.findOne({ where: { postId, userId } });
    if (sub && sub.unreadCount > 0) {
      sub.unreadCount = 0;
      await this.subRepository.save(sub);
      // 发送消除提醒
      this.chatGateway.server.to(`user_${userId}`).emit('bbsBadeRead', { postId });
    }
    return { success: true };
  }
}
