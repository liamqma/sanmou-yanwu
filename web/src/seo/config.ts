export const SITE = {
  name: '演武参谋',
  alternateName: '三国谋定天下演武参谋',
  origin: 'https://sanmouyanwu.com',
  image: '/logo512.png',
  language: 'zh-CN',
  locale: 'zh_CN',
} as const;

export interface SeoRoute {
  path: string;
  title: string;
  description: string;
  heading: string;
  navLabel: string;
  index: boolean;
  ogType: 'website' | 'article';
}

export const SEO_ROUTES: readonly SeoRoute[] = [
  {
    path: '/',
    title: '三国谋定天下演武配将与战法推荐｜演武参谋',
    description:
      '三国谋定天下演武配将工具，基于历史战报数据推荐武将、战法与三队阵容，并提供赛季筛选、选择分析和演武攻略。',
    heading: '演武配将与战法推荐',
    navLabel: '对局推荐',
    index: true,
    ogType: 'website',
  },
  {
    path: '/analytics',
    title: '三国谋定天下演武数据与武将战法排行｜演武参谋',
    description:
      '查看三国谋定天下演武的武将、战法、搭配、使用率和历史胜率参考，并按赛季与卡池筛选战报数据。',
    heading: '数据洞察',
    navLabel: '数据洞察',
    index: true,
    ogType: 'website',
  },
  {
    path: '/guides/yanwu',
    title: '三国谋定天下演武武将排行与强队阵容攻略｜演武参谋',
    description:
      '查看三国谋定天下演武国家武将榜、战法推荐、冠军与 S/A/B 强队阵容，以及阵容克制关系。',
    heading: '三国谋定天下演武武将与阵容指南',
    navLabel: '演武攻略',
    index: true,
    ogType: 'article',
  },
  {
    path: '/contributors',
    title: '三国谋定天下演武战报贡献榜｜演武参谋',
    description:
      '查看三国谋定天下演武社区战报贡献榜，了解帮助完善武将、战法与阵容推荐数据的贡献者。',
    heading: '战报贡献榜',
    navLabel: '战报贡献榜',
    index: true,
    ogType: 'website',
  },
  {
    path: '/contribute',
    title: '上传三国谋定天下演武战报｜演武参谋',
    description:
      '上传三国谋定天下演武战报截图或手动录入阵容，补充社区数据，帮助改进武将、战法与队伍推荐。',
    heading: '上传战报',
    navLabel: '上传战报',
    index: true,
    ogType: 'website',
  },
  {
    path: '/team-builder',
    title: '三国谋定天下演武三队编排｜演武参谋',
    description:
      '根据当前演武卡池生成三队编排，调整武将与战法并即时查看阵容评分。',
    heading: '队伍策案',
    navLabel: '队伍推荐',
    index: false,
    ogType: 'website',
  },
] as const;

export const NOT_FOUND_SEO: SeoRoute = {
  path: '/404',
  title: '页面未找到｜演武参谋',
  description: '没有找到你访问的演武参谋页面。',
  heading: '页面未找到',
  navLabel: '页面未找到',
  index: false,
  ogType: 'website',
};

export const normalizePath = (path: string) => {
  const normalized = path.replace(/\/+$/, '');
  return normalized || '/';
};

export const findSeoRoute = (path: string) =>
  SEO_ROUTES.find((route) => route.path === normalizePath(path)) ?? NOT_FOUND_SEO;

export const canonicalUrl = (route: SeoRoute) =>
  `${SITE.origin}${route.path === '/' ? '/' : route.path}`;

export const socialImageUrl = () => `${SITE.origin}${SITE.image}`;

export const buildStructuredData = (route: SeoRoute) => {
  const url = canonicalUrl(route);
  const website = {
    '@type': 'WebSite',
    '@id': `${SITE.origin}/#website`,
    url: `${SITE.origin}/`,
    name: SITE.name,
    alternateName: SITE.alternateName,
    inLanguage: SITE.language,
  };
  const webpage = {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: route.title,
    description: route.description,
    inLanguage: SITE.language,
    isPartOf: { '@id': website['@id'] },
  };

  const graph: Record<string, unknown>[] = [website, webpage];
  if (route.path !== '/') {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: SITE.name,
          item: `${SITE.origin}/`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: route.navLabel,
          item: url,
        },
      ],
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
};
