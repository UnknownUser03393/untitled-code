// Auto-generated stub — replace with real implementation
import type { SSHSessionManager, SSHSessionManagerOptions } from './SSHSessionManager.js'

// Minimal stand-in for Bun's Subprocess type (this file is a stub that is not
// exercised under Node). Marked as unknown since the real shape is never used.
type Subprocess = unknown

export interface SSHAuthProxy {
  stop(): void
}

export interface SSHSession {
  remoteCwd: string
  proc: Subprocess
  proxy: SSHAuthProxy
  createManager(options: SSHSessionManagerOptions): SSHSessionManager
  getStderrTail(): string
}

export class SSHSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}

export const createSSHSession: (...args: unknown[]) => Promise<SSHSession> = (async () => {
  throw new SSHSessionError('SSH sessions are not supported in this build')
});
export const createLocalSSHSession: (...args: unknown[]) => Promise<SSHSession> = (async () => {
  throw new SSHSessionError('Local SSH sessions are not supported in this build')
});
