import type { IpcMainInvokeEvent } from 'electron'

export type CollectedIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>

export interface LegacyIpcHandlerRegistrar {
  handle<Args extends unknown[], Result>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: Args) => Result
  ): void
}

export class LegacyIpcHandlerCollector implements LegacyIpcHandlerRegistrar {
  private readonly handlers = new Map<string, CollectedIpcHandler>()

  handle<Args extends unknown[], Result>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: Args) => Result
  ): void {
    if (!channel.trim()) throw new Error('IPC channel must be non-empty')
    if (this.handlers.has(channel)) throw new Error(`duplicate collected IPC channel: ${channel}`)
    this.handlers.set(channel, listener as CollectedIpcHandler)
  }

  require(channel: string): CollectedIpcHandler {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`missing collected IPC handler: ${channel}`)
    return handler
  }

  listChannels(): readonly string[] {
    return [...this.handlers.keys()].sort()
  }

  size(): number {
    return this.handlers.size
  }
}
