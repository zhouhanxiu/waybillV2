// 本地构建占位 stub：当 node_modules 未安装 bullmq/ioredis（如中通内部源损坏）
// 且使用默认 QUEUE_BACKEND=memory 时，构建仍能通过。生产/Vercel 安装真实包后，
// next.config 的 alias 仅在模块解析失败时兜底，redis 模式不受影响。
export default class OptionalStub {
  constructor(..._args: any[]) {
    throw new Error(
      "bullmq/ioredis 未安装。请安装依赖或设置 QUEUE_BACKEND=memory（默认）。"
    );
  }
  on() {}
  async add() {}
  async close() {}
}
