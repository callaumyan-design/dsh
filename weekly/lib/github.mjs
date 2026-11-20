// 用 GitHub REST API 补充仓库信息（话题、主页、许可证、创建时间、README 摘录）。
// 在 GitHub Actions 里用 GITHUB_TOKEN 认证；没有 token 也能跑，只是限额更低。
// 补充信息拿不到时不让整期失败：记录警告，点评只依据 Trending 上的简介。

const API = 'https://api.github.com';

// README 只取开头一段给 AI 写点评用：项目定位一般都写在前面，
// 而有些 README 长达数十万字，整份发送既贵又没必要。
export const README_EXCERPT_CHARS = 8000;

function headers(accept = 'application/vnd.github+json') {
  const h = { Accept: accept, 'User-Agent': 'github-weekly-bot', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function getJson(path, fetchImpl) {
  const res = await fetchImpl(`${API}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function getReadme(fullName, fetchImpl) {
  const res = await fetchImpl(`${API}/repos/${fullName}/readme`, { headers: headers('application/vnd.github.raw+json') });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET README → HTTP ${res.status}`);
  return res.text();
}

/** 去掉 README 里对理解项目没帮助的部分（HTML 标签、图片、徽章、多余空行）。 */
export function readmeExcerpt(markdown, limit = README_EXCERPT_CHARS) {
  if (!markdown) return null;
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '') // 带链接的徽章
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}\n…（以下省略）` : text;
}

/** 给每个仓库补上 API 信息；单个仓库失败只会少掉这部分信息。 */
export async function enrich(repos, { fetchImpl = fetch, log = console } = {}) {
  return Promise.all(
    repos.map(async (repo) => {
      const out = { ...repo, topics: [], homepage: null, license: null, createdAt: null, readme: null };
      try {
        const info = await getJson(`/repos/${repo.fullName}`, fetchImpl);
        out.topics = info.topics ?? [];
        out.homepage = info.homepage || null;
        out.license = info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : null;
        out.createdAt = info.created_at ?? null;
        out.description ??= info.description || null;
      } catch (err) {
        log.warn(`⚠ ${repo.fullName}: 读取仓库信息失败（${err.message}）`);
      }
      try {
        out.readme = readmeExcerpt(await getReadme(repo.fullName, fetchImpl));
      } catch (err) {
        log.warn(`⚠ ${repo.fullName}: 读取 README 失败（${err.message}）`);
      }
      return out;
    }),
  );
}
