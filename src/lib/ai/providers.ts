/*
 * プロバイダの表(v1.43)。既定値だけを置く純データ。
 *
 * **モデルは候補を出すだけで強制しない。** モデル ID は数か月で古くなるので、
 * 設定画面では datalist にして手打ちも通す(v1.42 までの自由入力の良さを壊さない)
 */

import type { ProviderId } from './types';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** 既定の基础 URL。openai_compat だけはユーザーが入れる(ここは空) */
  baseUrl: string;
  defaultModel: string;
  /** 設定画面の datalist に出す候補 */
  models: readonly string[];
  keyPlaceholder: string;
  /** キーの取得先。設定画面の案内に出す */
  keyHint: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    keyPlaceholder: 'sk-ant-...',
    keyHint: '可在 console.anthropic.com 申请（与 Claude Pro / Max 订阅是独立合约）',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (GPT)',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
    keyPlaceholder: 'sk-...',
    keyHint: '可在 platform.openai.com 申请(与 ChatGPT Plus 订阅为不同合同)',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    keyPlaceholder: 'AIza...',
    keyHint: '可在 aistudio.google.com 的「Get API key」中申请',
  },
  openai_compat: {
    id: 'openai_compat',
    label: 'OpenAI 互換',
    baseUrl: '',
    defaultModel: '',
    models: [],
    keyPlaceholder: '(不需要则留空)',
    keyHint:
      '可连接到 OpenRouter、Ollama、LM Studio 等具有 OpenAI 兼容 API 的服务或本地 LLM',
  },
};

/** openai_compat 用の基础 URL プリセット */
export const COMPAT_PRESETS: { label: string; baseUrl: string }[] = [
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
];

/** 未知の文字列(手で DB を書いた値·将来消したプロバイダの残骸)は anthropic に落とす */
export function parseProviderId(raw: string | null): ProviderId {
  if (raw && raw in PROVIDERS) return raw as ProviderId;
  return 'anthropic';
}

/** 末尾の / を落とす。`https://x/v1/` と `https://x/v1` で URL が二重スラッシュにならないように */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}
