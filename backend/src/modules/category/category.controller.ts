import {
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { CategoryService } from './category.service';

@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /**
   * 上传 Excel 导入分类（清空旧数据后全量写入）
   */
  @Post('import')
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Permissions('settings:edit')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('请上传 Excel 文件');
    }
    const result = await this.categoryService.importFromExcel(file.buffer);
    return {
      code: 0,
      message: `成功导入 ${result.imported} 条分类数据`,
      data: result,
    };
  }

  /**
   * 获取三级联动树（给前端 Cascader 用）
   */
  @Get('tree')
  @UseGuards(AuthGuard('jwt'))
  async getTree() {
    const data = await this.categoryService.getTree();
    return { code: 0, data };
  }

  /**
   * 获取全部扁平记录（管理后台预览用）
   */
  @Get('all')
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Permissions('settings:read')
  async findAll() {
    const data = await this.categoryService.findAll();
    return { code: 0, data };
  }
}
