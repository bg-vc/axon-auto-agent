import path from 'node:path'
import { realpath } from 'node:fs/promises'

export function resolveWorkspacePath(workspacePath: string, requestedPath: string): string {
  const root = path.resolve(workspacePath)
  const target = path.resolve(root, requestedPath)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The requested path is outside the selected workspace.')
  }
  return target
}

function assertRealPathInside(rootPath: string, targetPath: string): void {
  const relative = path.relative(rootPath, targetPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The requested path escapes the selected workspace through a symbolic link.')
  }
}

/**
 * Verify real filesystem ancestry as well as lexical path boundaries. For a new output,
 * the nearest existing parent is checked so a symlinked directory cannot redirect writes.
 */
export async function resolveWorkspacePathSecure(
  workspacePath: string,
  requestedPath: string,
  options: { allowMissing?: boolean } = {},
): Promise<string> {
  const targetPath = resolveWorkspacePath(workspacePath, requestedPath)
  const realRoot = await realpath(workspacePath)
  let probePath = targetPath

  while (true) {
    try {
      assertRealPathInside(realRoot, await realpath(probePath))
      return targetPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.allowMissing) throw error
      const parentPath = path.dirname(probePath)
      if (parentPath === probePath) throw error
      probePath = parentPath
    }
  }
}

export function isPathInsideWorkspace(workspacePath: string, targetPath: string): boolean {
  try {
    resolveWorkspacePath(workspacePath, path.relative(workspacePath, targetPath))
    return true
  } catch {
    return false
  }
}

export function mediaTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.ts': 'text/typescript', '.tsx': 'text/tsx', '.jsx': 'text/jsx',
    '.csv': 'text/csv', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4',
    '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  }
  return types[extension] ?? 'application/octet-stream'
}

export function isPreviewableMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/') || mediaType.startsWith('image/') || mediaType === 'application/json' || mediaType === 'application/pdf'
}
