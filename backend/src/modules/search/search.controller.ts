import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('search')
@UseGuards(AuthGuard('jwt'))
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(
    @Query('q') query: string,
    @Query('type') type?: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    if (!query) return { total: 0, items: [] };
    return this.searchService.search(
      query,
      type || 'all',
      parseInt(page, 10),
      parseInt(pageSize, 10),
    );
  }

  @Post('sync')
  async syncAll() {
    return this.searchService.syncAll();
  }
}
