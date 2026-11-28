import type { LineupResponse, LineupTask, LineupTasks } from './lineupProtocol';

/** The request was replaced by a newer one of the same task before it started. */
export class LineupSuperseded extends Error {
  constructor() {
    super('已被更新的请求取代，请重试');
  }
}

interface Pending {
  resolve: (output: never) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

const failAll = (error: Error): void => {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
  worker?.terminate();
  worker = null;
};

const getWorker = (): Worker => {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/lineup.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<LineupResponse>) => {
    const request = pending.get(data.id);
    if (!request) return;
    if ('progress' in data) {
      request.onProgress?.(data.progress);
      return;
    }
    pending.delete(data.id);
    if ('output' in data) request.resolve(data.output as never);
    else request.reject('superseded' in data ? new LineupSuperseded() : new Error(data.error));
  };
  worker.onerror = (event) => failAll(new Error(event.message || '阵容模型加载失败'));
  return worker;
};

/** Run a lineup-model task in the background worker. */
export function runLineup<Task extends LineupTask>(
  task: Task,
  input: LineupTasks[Task]['input'],
  onProgress?: (progress: number) => void
): Promise<LineupTasks[Task]['output']> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('当前浏览器不支持后台计算'));
      return;
    }
    const id = ++nextId;
    pending.set(id, { resolve, reject, onProgress });
    try {
      getWorker().postMessage({ id, task, input });
    } catch (error) {
      pending.delete(id);
      reject(error as Error);
    }
  });
}
