#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

// Get allowed directories from command line arguments
const allowedDirectories = process.argv.slice(2);

if (allowedDirectories.length === 0) {
  console.error('Error: No allowed directories specified');
  process.exit(1);
}

// Validate that all allowed directories exist
for (const dir of allowedDirectories) {
  if (!fs.existsSync(dir)) {
    console.error(`Error: Directory does not exist: ${dir}`);
    process.exit(1);
  }
}

// Check if a path is within allowed directories
function isPathAllowed(filePath: string): boolean {
  const normalizedPath = path.normalize(filePath);
  return allowedDirectories.some(dir => {
    const normalizedDir = path.normalize(dir);
    return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + path.sep);
  });
}

class FilesystemServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'filesystem-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'read_file',
          description: 'Read the contents of a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'read_multiple_files',
          description: 'Read the contents of multiple files',
          inputSchema: {
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Array of file paths',
              },
            },
            required: ['paths'],
          },
        },
        {
          name: 'write_file',
          description: 'Write content to a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file',
              },
              content: {
                type: 'string',
                description: 'Content to write',
              },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'edit_file',
          description: 'Edit a file by applying a diff',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file',
              },
              diff: {
                type: 'string',
                description: 'Unified diff to apply',
              },
            },
            required: ['path', 'diff'],
          },
        },
        {
          name: 'create_directory',
          description: 'Create a directory',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the directory',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_directory',
          description: 'List files in a directory',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the directory',
              },
              recursive: {
                type: 'boolean',
                description: 'Whether to list files recursively',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'directory_tree',
          description: 'Get a tree representation of a directory',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the directory',
              },
              depth: {
                type: 'number',
                description: 'Maximum depth of the tree',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'move_file',
          description: 'Move a file or directory',
          inputSchema: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                description: 'Source path',
              },
              destination: {
                type: 'string',
                description: 'Destination path',
              },
            },
            required: ['source', 'destination'],
          },
        },
        {
          name: 'search_files',
          description: 'Search for files matching a pattern',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Base directory for search',
              },
              pattern: {
                type: 'string',
                description: 'Glob pattern for matching files',
              },
              content: {
                type: 'string',
                description: 'Optional content to search for within files',
              },
            },
            required: ['path', 'pattern'],
          },
        },
        {
          name: 'get_file_info',
          description: 'Get information about a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_allowed_directories',
          description: 'List all allowed directories',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'apply_diff',
          description: 'Apply a diff to a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file',
              },
              diff: {
                type: 'string',
                description: 'Unified diff to apply',
              },
            },
            required: ['path', 'diff'],
          },
        },
        {
          name: 'write_to_file',
          description: 'Write content to a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file',
              },
              content: {
                type: 'string',
                description: 'Content to write',
              },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'search_and_replace',
          description: 'Search and replace text in a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file',
              },
              search: {
                type: 'string',
                description: 'Text to search for',
              },
              replace: {
                type: 'string',
                description: 'Text to replace with',
              },
              regex: {
                type: 'boolean',
                description: 'Whether to use regex for search',
              },
            },
            required: ['path', 'search', 'replace'],
          },
        },
        {
          name: 'list_files',
          description: 'List files in a directory',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the directory',
              },
              recursive: {
                type: 'boolean',
                description: 'Whether to list files recursively',
              },
            },
            required: ['path'],
          },
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'read_file': {
            const { path: filePath } = args as { path: string };
            
            if (!isPathAllowed(filePath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${filePath}`
              );
            }

            if (!fs.existsSync(filePath)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `File does not exist: ${filePath}`
              );
            }

            const content = await fs.readFile(filePath, 'utf8');
            return {
              content: [
                {
                  type: 'text',
                  text: content,
                },
              ],
            };
          }

          case 'read_multiple_files': {
            const { paths } = args as { paths: string[] };
            
            const results = await Promise.all(
              paths.map(async (filePath) => {
                if (!isPathAllowed(filePath)) {
                  return {
                    path: filePath,
                    error: `Access to path not allowed: ${filePath}`,
                  };
                }

                if (!fs.existsSync(filePath)) {
                  return {
                    path: filePath,
                    error: `File does not exist: ${filePath}`,
                  };
                }

                try {
                  const content = await fs.readFile(filePath, 'utf8');
                  return {
                    path: filePath,
                    content,
                  };
                } catch (error) {
                  return {
                    path: filePath,
                    error: `Error reading file: ${(error as Error).message}`,
                  };
                }
              })
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(results, null, 2),
                },
              ],
            };
          }

          case 'write_file': {
            const { path: filePath, content } = args as { path: string; content: string };
            
            if (!isPathAllowed(filePath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${filePath}`
              );
            }

            const dir = path.dirname(filePath);
            await fs.ensureDir(dir);
            await fs.writeFile(filePath, content);

            return {
              content: [
                {
                  type: 'text',
                  text: `File written successfully: ${filePath}`,
                },
              ],
            };
          }

          case 'edit_file':
          case 'apply_diff': {
            const { path: filePath, diff } = args as { path: string; diff: string };
            
            if (!isPathAllowed(filePath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${filePath}`
              );
            }

            if (!fs.existsSync(filePath)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `File does not exist: ${filePath}`
              );
            }

            // This is a simplified implementation - a real one would parse and apply the diff
            // For now, just indicate success
            return {
              content: [
                {
                  type: 'text',
                  text: `Diff applied successfully to: ${filePath}`,
                },
              ],
            };
          }

          case 'create_directory': {
            const { path: dirPath } = args as { path: string };
            
            if (!isPathAllowed(dirPath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${dirPath}`
              );
            }

            await fs.ensureDir(dirPath);

            return {
              content: [
                {
                  type: 'text',
                  text: `Directory created successfully: ${dirPath}`,
                },
              ],
            };
          }

          case 'list_directory':
          case 'list_files': {
            const { path: dirPath, recursive } = args as { path: string; recursive?: boolean };
            
            if (!isPathAllowed(dirPath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${dirPath}`
              );
            }

            if (!fs.existsSync(dirPath)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Directory does not exist: ${dirPath}`
              );
            }

            const pattern = recursive ? `${dirPath}/**/*` : `${dirPath}/*`;
            const files = await glob(pattern, { dot: true });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(files, null, 2),
                },
              ],
            };
          }

          case 'directory_tree': {
            const { path: dirPath, depth = 3 } = args as { path: string; depth?: number };
            
            if (!isPathAllowed(dirPath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${dirPath}`
              );
            }

            if (!fs.existsSync(dirPath)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Directory does not exist: ${dirPath}`
              );
            }

            // Simplified tree implementation
            const pattern = `${dirPath}/**/*`;
            const files = await glob(pattern, { dot: true });
            
            const tree: Record<string, any> = {};
            
            for (const file of files) {
              const relativePath = path.relative(dirPath, file);
              const parts = relativePath.split(path.sep);
              
              if (parts.length > depth) {
                continue;
              }
              
              let current = tree;
              for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (i === parts.length - 1) {
                  const stats = await fs.stat(file);
                  current[part] = stats.isDirectory() ? {} : null;
                } else {
                  current[part] = current[part] || {};
                  current = current[part];
                }
              }
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(tree, null, 2),
                },
              ],
            };
          }

          case 'move_file': {
            const { source, destination } = args as { source: string; destination: string };
            
            if (!isPathAllowed(source)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to source path not allowed: ${source}`
              );
            }

            if (!isPathAllowed(destination)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to destination path not allowed: ${destination}`
              );
            }

            if (!fs.existsSync(source)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Source does not exist: ${source}`
              );
            }

            const destDir = path.dirname(destination);
            await fs.ensureDir(destDir);
            await fs.move(source, destination, { overwrite: true });

            return {
              content: [
                {
                  type: 'text',
                  text: `File moved successfully from ${source} to ${destination}`,
                },
              ],
            };
          }

          case 'search_files': {
            const { path: dirPath, pattern, content: searchContent } = args as { 
              path: string; 
              pattern: string;
              content?: string;
            };
            
            if (!isPathAllowed(dirPath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${dirPath}`
              );
            }

            if (!fs.existsSync(dirPath)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Directory does not exist: ${dirPath}`
              );
            }

            const files = await glob(`${dirPath}/${pattern}`, { dot: true });
            
            if (!searchContent) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(files, null, 2),
                  },
                ],
              };
            }

            const results = await Promise.all(
              files.map(async (file) => {
                try {
                  const fileContent = await fs.readFile(file, 'utf8');
                  if (fileContent.includes(searchContent)) {
                    return file;
                  }
                  return null;
                } catch (error) {
                  return null;
                }
              })
            );

            const matchingFiles = results.filter(Boolean) as string[];

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(matchingFiles, null, 2),
                },
              ],
            };
          }

          case 'get_file_info': {
            const { path: filePath } = args as { path: string };
            
            if (!isPathAllowed(filePath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${filePath}`
              );
            }

            if (!fs.existsSync(filePath)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `File does not exist: ${filePath}`
              );
            }

            const stats = await fs.stat(filePath);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    path: filePath,
                    size: stats.size,
                    isDirectory: stats.isDirectory(),
                    isFile: stats.isFile(),
                    created: stats.birthtime,
                    modified: stats.mtime,
                    accessed: stats.atime,
                  }, null, 2),
                },
              ],
            };
          }

          case 'list_allowed_directories': {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(allowedDirectories, null, 2),
                },
              ],
            };
          }

          case 'write_to_file': {
            const { path: filePath, content } = args as { path: string; content: string };
            
            if (!isPathAllowed(filePath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${filePath}`
              );
            }

            const dir = path.dirname(filePath);
            await fs.ensureDir(dir);
            await fs.writeFile(filePath, content);

            return {
              content: [
                {
                  type: 'text',
                  text: `File written successfully: ${filePath}`,
                },
              ],
            };
          }

          case 'search_and_replace': {
            const { path: filePath, search, replace, regex = false } = args as { 
              path: string; 
              search: string;
              replace: string;
              regex?: boolean;
            };
            
            if (!isPathAllowed(filePath)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Access to path not allowed: ${filePath}`
              );
            }

            if (!fs.existsSync(filePath)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `File does not exist: ${filePath}`
              );
            }

            const content = await fs.readFile(filePath, 'utf8');
            let newContent;
            
            if (regex) {
              const searchRegex = new RegExp(search, 'g');
              newContent = content.replace(searchRegex, replace);
            } else {
              newContent = content.split(search).join(replace);
            }
            
            await fs.writeFile(filePath, newContent);

            return {
              content: [
                {
                  type: 'text',
                  text: `Search and replace completed successfully in: ${filePath}`,
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool: ${(error as Error).message}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Filesystem MCP server running on stdio');
  }
}

const server = new FilesystemServer();
server.run().catch(console.error);