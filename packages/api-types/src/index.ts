/**
 * 由 openapi.yaml 生成的类型（工程契约 R2：接口契约单点定义）
 * 生成命令：pnpm codegen:api
 */
import type { components, paths } from './schema';

export type { components, paths };

export type Schemas = components['schemas'];
export type Schema<K extends keyof Schemas> = Schemas[K];

/** 统一响应包：{ code, message, data, requestId } */
export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}

export type Paths = paths;
