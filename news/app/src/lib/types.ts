export interface SourceRef {
  name: string;
  url: string;
  title: string;
  lang: string;
  publishedAt: string | null;
}

export interface Story {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  importance: number | null;
  image: string | null;
  publishedAt: string | null;
  sources: SourceRef[];
}

export interface Brief {
  id: string;
  name: string;
  url: string;
  tagline: string | null;
  summary: string | null;
  image: string | null;
  repo?: { language: string | null; stars: number | null; starsToday: number | null };
}

export interface Edition {
  date: string;
  generatedAt: string;
  ai: { provider: string; model: string } | null;
  headline: string | null;
  stories: Story[];
  products: Brief[];
  github: Brief[];
  sourceStatus: { id: string; name: string; ok: boolean; count: number; error?: string }[];
  aiErrors: { step: string; message: string }[];
}

export interface EditionIndexEntry {
  date: string;
  headline: string | null;
  storyCount: number;
  generatedAt: string;
}

export interface User {
  id: string;
  name: string;
  createdAt: string;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  date: string | null;
  category: string | null;
  source: string | null;
  savedAt: string;
}
