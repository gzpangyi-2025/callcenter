import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlobalSearchData, SearchResultItem } from '../../types/api';
import GlobalSearch from '.';

const searchApiMock = vi.hoisted(() => ({
  search: vi.fn<(params: { q: string; type?: string; page?: number; pageSize?: number }) => Promise<GlobalSearchData>>(),
}));

vi.mock('../../services/api', () => ({
  searchAPI: searchApiMock,
}));

const makeSearchItem = (overrides: Partial<SearchResultItem> = {}): SearchResultItem => ({
  id: 1,
  type: 'knowledge',
  title: 'Oracle RAC 故障复盘',
  content: '关键处理步骤',
  highlight: {
    title: ['<em>Oracle</em> RAC 故障复盘'],
    content: ['关键<em>处理</em>步骤'],
  },
  authorName: 'agent',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
};

const renderGlobalSearch = (initialPath = '/search?q=oracle&type=all') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/search" element={<><GlobalSearch /><LocationProbe /></>} />
        <Route path="/knowledge" element={<LocationProbe />} />
        <Route path="/tickets/:id" element={<LocationProbe />} />
        <Route path="/bbs/:id" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe('GlobalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchApiMock.search.mockResolvedValue({
      total: 1,
      aggregations: {},
      items: [makeSearchItem()],
    });
  });

  it('loads global search results and renders highlighted fragments', async () => {
    renderGlobalSearch();

    expect(await screen.findByText('全站搜索')).toBeInTheDocument();
    expect(await screen.findByText('Oracle')).toBeInTheDocument();
    expect(screen.getByText('RAC 故障复盘')).toBeInTheDocument();
    expect(screen.getByText('处理')).toBeInTheDocument();
    expect(searchApiMock.search).toHaveBeenCalledWith({
      q: 'oracle',
      type: 'all',
      page: 1,
      pageSize: 50,
    });
  });

  it('updates query params and reloads results when switching result type', async () => {
    renderGlobalSearch();

    fireEvent.click(await screen.findByText('工单广场'));

    await waitFor(() => {
      expect(searchApiMock.search).toHaveBeenLastCalledWith({
        q: 'oracle',
        type: 'ticket',
        page: 1,
        pageSize: 50,
      });
    });
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=oracle&type=ticket');
  });

  it('navigates knowledge and ticket results to their target pages', async () => {
    const { unmount } = renderGlobalSearch();

    fireEvent.click(await screen.findByText('Oracle'));
    expect(await screen.findByTestId('location')).toHaveTextContent('/knowledge?viewId=1');

    unmount();
    searchApiMock.search.mockResolvedValue({
      total: 1,
      aggregations: {},
      items: [makeSearchItem({ id: 88, type: 'ticket', title: '交换机故障', highlight: undefined })],
    });
    renderGlobalSearch('/search?q=switch&type=ticket');

    fireEvent.click(await screen.findByText('交换机故障'));
    expect(await screen.findByTestId('location')).toHaveTextContent('/tickets/88');
  });
});
