const { createClient } = require('webdav');
const fs = require('fs');
const path = require('path');

let webdavClient = null;
let cachedUrl = null;

function getWebDAVClient() {
  let url = process.env.WEBDAV_URL;
  const username = process.env.WEBDAV_USERNAME;
  const password = process.env.WEBDAV_PASSWORD;

  if (!url || !username || !password) {
    throw new Error('WebDAV credentials not configured in .env file');
  }

  // Normalize URL - remove trailing slash if present
  url = url.trim();
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  // Reset client if URL has changed
  if (webdavClient && cachedUrl !== url) {
    console.log(`WebDAV URL changed from ${cachedUrl} to ${url}, resetting client...`);
    webdavClient = null;
    cachedUrl = null;
  }

  // Create new client if needed
  if (!webdavClient) {
    console.log(`Creating WebDAV client with URL: ${url}`);
    
    // Create WebDAV client with authentication
    // The webdav library supports Basic and Digest authentication automatically
    // Some servers may need explicit authType
    const authType = process.env.WEBDAV_AUTH_TYPE || 'auto'; // 'auto', 'basic', 'digest', 'none'
    
    const clientOptions = {
      username,
      password,
      headers: {
        'User-Agent': 'WebDAV-EasyAccess/1.0',
        'Accept-Charset': 'utf-8',
      },
    };

    // If authType is specified and not 'auto', add it
    if (authType !== 'auto') {
      clientOptions.authType = authType;
    }

    webdavClient = createClient(url, clientOptions);
    cachedUrl = url;
  }

  return webdavClient;
}

function resetWebDAVClient() {
  webdavClient = null;
  cachedUrl = null;
  console.log('WebDAV client reset');
}

async function listDirectory(path = '/') {
  const client = getWebDAVClient();
  try {
    // Normalize path
    // If URL already contains a path (like /rct3232), we might need to adjust
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    
    // For URLs with paths, try empty string or relative path
    // Some WebDAV servers expect relative paths when URL already contains path
    let requestPath = path;
    const baseUrl = process.env.WEBDAV_URL?.trim() || '';
    
    // If URL contains a path segment, we might need to use empty string or adjust
    if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
      // URL has a path component, try using empty string for root
      if (path === '/') {
        requestPath = '';
      }
    }
    const items = await client.getDirectoryContents(requestPath);
    return items.map(item => ({
      filename: item.filename,
      basename: item.basename,
      lastmod: item.lastmod,
      size: item.size,
      type: item.type,
      mime: item.mime,
    }));
  } catch (error) {
    if (error.status === 401 || error.response?.status === 401) {
      const detailedError = `WebDAV authentication failed (401 Unauthorized). 
      
Possible causes:
1. Incorrect username or password in .env file
2. WebDAV server requires different authentication method
3. URL format issue - try removing path from WEBDAV_URL if it includes username

Current settings:
- URL: ${process.env.WEBDAV_URL}
- Username: ${process.env.WEBDAV_USERNAME}
- Password: ${process.env.WEBDAV_PASSWORD ? 'SET' : 'NOT SET'}

Original error: ${error.message}`;
      throw new Error(detailedError);
    }
    
    throw new Error(`Failed to list directory: ${error.message}`);
  }
}

async function getFileContents(filePath) {
  const client = getWebDAVClient();
  try {
    // Normalize path
    let normalizedPath = filePath.trim();
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
    
    // Remove trailing slash for files
    if (normalizedPath.endsWith('/') && normalizedPath !== '/') {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    
    // Check if base URL has a path component (like /rct3232)
    const baseUrl = process.env.WEBDAV_URL?.trim() || '';
    let requestPath = normalizedPath;
    
    // If base URL contains a path, we need to handle it carefully
    // The webdav library combines base URL path with request path
    if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
      // Extract the base path from URL (e.g., /rct3232 from https://server.com/rct3232)
      const urlParts = baseUrl.split('/');
      const basePath = '/' + urlParts.slice(3).join('/'); // Get path after domain
      
      // If request path is root, use empty string (so it uses base URL path)
      if (normalizedPath === '/') {
        requestPath = '';
      } else {
        // For non-root paths, remove leading slash to make it relative to base path
        // The library will combine: baseUrl + basePath + requestPath
        // So if baseUrl is https://server.com/webdav/rct3232 and requestPath is /hastag.png
        // We want: https://server.com/webdav/rct3232/hastag.png
        // But the library might do: https://server.com/webdav/rct3232 + /hastag.png = https://server.com/webdav/hastag.png (wrong!)
        // So we need to remove the leading slash to make it relative
        requestPath = normalizedPath.substring(1); // Remove leading /
      }
    }
    
    console.log(`[WebDAV] Getting file contents: original=${filePath}, normalized=${normalizedPath}, requestPath=${requestPath}, baseUrl=${baseUrl}`);
    
    // Try to get the actual URL that will be requested
    // The webdav library doesn't expose this directly, but we can infer it
    let inferredUrl;
    if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
      // Base URL has a path component
      if (requestPath.startsWith('/')) {
        inferredUrl = baseUrl + requestPath;
      } else {
        inferredUrl = baseUrl + '/' + requestPath;
      }
    } else {
      inferredUrl = baseUrl + (requestPath.startsWith('/') ? requestPath : '/' + requestPath);
    }
    console.log(`[WebDAV] Inferred request URL: ${inferredUrl}`);
    
    const buffer = await client.getFileContents(requestPath);
    console.log(`[WebDAV] File contents retrieved: ${buffer.length} bytes for path ${filePath} (requestPath: ${requestPath})`);
    
    return buffer;
  } catch (error) {
    console.error(`[WebDAV] Error getting file contents for ${filePath}:`, error);
    throw new Error(`Failed to get file contents: ${error.message}`);
  }
}

async function putFileContents(path, buffer) {
  const client = getWebDAVClient();
  try {
    // Normalize path
    let normalizedPath = path.trim();
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
    
    // Remove trailing slash if present (files shouldn't have trailing slash)
    if (normalizedPath.endsWith('/') && normalizedPath !== '/') {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    
    // Check if base URL has a path component
    const baseUrl = process.env.WEBDAV_URL?.trim() || '';
    let requestPath = normalizedPath;
    
    // If base URL contains a path (like /rct3232), we need to handle it carefully
    // The webdav library combines base URL path with request path
    if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
      // Extract the base path from URL (e.g., /rct3232 from https://server.com/rct3232)
      const urlParts = baseUrl.split('/');
      const basePath = '/' + urlParts.slice(3).join('/'); // Get path after domain
      
      // If request path is root, use empty string (so it uses base URL path)
      if (normalizedPath === '/') {
        requestPath = '';
      } else {
        // For non-root paths, use the path as-is
        // The library will combine: baseUrl + requestPath
        requestPath = normalizedPath;
      }
    }
    
    await client.putFileContents(requestPath, buffer);
    return { success: true };
  } catch (error) {
    if (error.status === 404 || error.response?.status === 404) {
      throw new Error(`Path not found: ${path}. Please ensure the parent directory exists.`);
    } else if (error.status === 403 || error.response?.status === 403) {
      throw new Error(`Permission denied: Cannot upload to ${path}`);
    } else if (error.status === 409 || error.response?.status === 409) {
      throw new Error(`Conflict: File may already exist or parent directory is missing: ${path}`);
    } else if (error.status === 500 || error.response?.status === 500) {
      const actualUrl = error.response?.url || 'unknown';
      const serverError = `WebDAV server error (500). 

Request URL: ${actualUrl}
Expected path: ${path}

Possible causes:
1. URL path mismatch - server may be using different base path
2. File path contains invalid characters
3. File size exceeds server limits
4. Parent directory does not exist
5. Server configuration issue

Try checking your WEBDAV_URL in .env file. If it includes a path (like /rct3232),
the server might be expecting a different path format.

Original error: ${error.message}`;
      throw new Error(serverError);
    } else if (error.message.includes('ECONNREFUSED')) {
      throw new Error(`Connection refused. Please check your WebDAV server URL and network connection. Original: ${error.message}`);
    }
    
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

async function deleteFile(path) {
  const client = getWebDAVClient();
  try {
    // Normalize path
    let normalizedPath = path.trim();
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
    
    // First, try to determine if it's a directory by checking parent directory
    let isDirectory = false;
    try {
      const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) || '/';
      const items = await client.getDirectoryContents(parentPath);
      const item = items.find(i => {
        const itemPath = i.filename || i.basename;
        return itemPath === normalizedPath || itemPath === normalizedPath + '/' || itemPath + '/' === normalizedPath;
      });
      if (item) {
        isDirectory = item.type === 'directory';
      }
    } catch (err) {
      // If we can't determine, try both methods
    }
    
    // For directories, some WebDAV servers require trailing slash
    // Try without slash first (standard), then with slash if it fails
    let deletePath = normalizedPath;
    if (isDirectory && !deletePath.endsWith('/')) {
      deletePath = deletePath + '/';
    }
    
    try {
      // Try deleting with the determined path
      await client.deleteFile(deletePath);
      return { success: true };
    } catch (firstError) {
      // If it's a directory and first attempt failed, try with/without trailing slash
      if (isDirectory) {
        const alternatePath = deletePath.endsWith('/') 
          ? deletePath.slice(0, -1) 
          : deletePath + '/';
        try {
          await client.deleteFile(alternatePath);
          return { success: true };
        } catch (secondError) {
          // Both attempts failed, throw the original error
          throw firstError;
        }
      } else {
        throw firstError;
      }
    }
  } catch (error) {
    if (error.status === 404 || error.response?.status === 404) {
      throw new Error(`File or folder not found: ${path}`);
    } else if (error.status === 403 || error.response?.status === 403) {
      throw new Error(`Permission denied: Cannot delete ${path}`);
    } else if (error.status === 409 || error.response?.status === 409) {
      throw new Error(`Directory not empty or conflict: ${path}. Some WebDAV servers require directories to be empty before deletion.`);
    } else if (error.message.includes('ECONNREFUSED')) {
      throw new Error(`Connection refused. Please check your WebDAV server URL and network connection. Original: ${error.message}`);
    }
    
    throw new Error(`Failed to delete: ${error.message}`);
  }
}

async function moveFile(sourcePath, destinationPath, progressCallback) {
  const client = getWebDAVClient();
  try {
    // Normalize paths
    let normalizedSource = sourcePath.trim();
    let normalizedDest = destinationPath.trim();
    
    if (!normalizedSource.startsWith('/')) {
      normalizedSource = '/' + normalizedSource;
    }
    if (!normalizedDest.startsWith('/')) {
      normalizedDest = '/' + normalizedDest;
    }
    
    // Remove trailing slash from destination if present (except root)
    if (normalizedDest.endsWith('/') && normalizedDest !== '/') {
      normalizedDest = normalizedDest.slice(0, -1);
    }
    
    console.log(`Moving file from ${normalizedSource} to ${normalizedDest} (Manual Mode)`);
    
    // Check if source is a directory or file
    let isDirectory = false;
    try {
      const sourceItems = await client.getDirectoryContents(normalizedSource);
      isDirectory = true;
    } catch (dirError) {
      // Not a directory, treat as file
      isDirectory = false;
    }
    
    if (isDirectory) {
      // Directory move: recursive copy then delete
      console.log(`Source is a directory, using recursive move`);
      
      // 1. Create destination directory
      try {
        await createDirectory(normalizedDest);
      } catch (createError) {
        // Directory might already exist, that's okay
        if (!createError.message.includes('already exists')) {
          throw createError;
        }
      }
      
      // 2. List all items in source directory
      const sourceItems = await listDirectory(normalizedSource);
      
      // 3. Recursively move each item
      for (const item of sourceItems) {
        const sourceItemPath = item.filename || `${normalizedSource}/${item.basename}`;
        const destItemPath = `${normalizedDest}/${item.basename}`;
        
        // Recursively move each item
        await moveFile(sourceItemPath, destItemPath);
      }
      
      // 4. Delete original directory
      await deleteFile(normalizedSource);
      
      console.log(`Successfully moved (recursive) directory from ${normalizedSource} to ${normalizedDest}`);
      return { success: true };
    } else {
      // File move: Download -> Upload -> Delete
      // This is used to bypass complex WebDAV proxy/port/redirect issues (30035 port, 502 errors)
      // It's slower but reliable.
      
      try {
        // Get file size first for accurate progress tracking
        let fileSize = 0;
        try {
          const parentPath = normalizedSource.substring(0, normalizedSource.lastIndexOf('/')) || '/';
          const fileName = normalizedSource.substring(normalizedSource.lastIndexOf('/') + 1);
          const items = await listDirectory(parentPath);
          const fileItem = items.find(item => item.basename === fileName);
          if (fileItem && fileItem.size) {
            fileSize = fileItem.size;
          }
        } catch (err) {
          // Ignore error
        }

        // 1. Read content - use our wrapper function to ensure proper path handling
        console.log(`[Move] Reading source file: ${normalizedSource}`);
        if (progressCallback && fileSize > 0) {
          progressCallback({ stage: 'downloading', progress: 0, total: fileSize });
        }
        const buffer = await getFileContents(normalizedSource);
        console.log(`[Move] Read ${buffer.length} bytes from ${normalizedSource}`);
        if (progressCallback && fileSize > 0) {
          progressCallback({ stage: 'downloading', progress: buffer.length, total: fileSize });
        }
        
        // 2. Write to new location - use our wrapper function
        console.log(`[Move] Writing to destination: ${normalizedDest}`);
        if (progressCallback && fileSize > 0) {
          progressCallback({ stage: 'uploading', progress: buffer.length, total: fileSize });
        }
        await putFileContents(normalizedDest, buffer);
        console.log(`[Move] Wrote ${buffer.length} bytes to ${normalizedDest}`);
        
        // 3. Delete original
        await deleteFile(normalizedSource);
        
        if (progressCallback && fileSize > 0) {
          progressCallback({ stage: 'completed', progress: fileSize, total: fileSize });
        }
        
        console.log(`Successfully moved (manual) file from ${normalizedSource} to ${normalizedDest}`);
        return { success: true };
        
      } catch (manualError) {
        console.error('Manual move failed:', manualError);
        throw manualError;
      }
    }

  } catch (error) {
    console.error('Move file error details:', {
      sourcePath,
      destinationPath,
      error: error.message,
      status: error.status,
      response: error.response
    });
    
    if (error.message.includes('does not exist') || error.message.includes('already exists')) {
      throw error;
    }
    
    if (error.status === 502 || error.response?.status === 502) {
      throw new Error('WebDAV server is not responding. Please check if the WebDAV server is running and accessible.');
    }
    
    if (error.message.includes('ECONNREFUSED')) {
      throw new Error('Cannot connect to WebDAV server. Please check the WEBDAV_URL in your .env file.');
    }
    
    throw new Error(`Failed to move file: ${error.message}`);
  }
}

async function copyFile(sourcePath, destinationPath, progressCallback) {
  const client = getWebDAVClient();
  try {
    // Normalize paths
    let normalizedSource = sourcePath.trim();
    let normalizedDest = destinationPath.trim();
    
    if (!normalizedSource.startsWith('/')) {
      normalizedSource = '/' + normalizedSource;
    }
    if (!normalizedDest.startsWith('/')) {
      normalizedDest = '/' + normalizedDest;
    }
    
    console.log(`Copying file from ${normalizedSource} to ${normalizedDest}`);
    
    // Check if source is a directory or file
    let isDirectory = false;
    try {
      const sourceItems = await client.getDirectoryContents(normalizedSource);
      isDirectory = true;
    } catch (dirError) {
      // Not a directory, treat as file
      isDirectory = false;
    }
    
    if (isDirectory) {
      // Directory copy: recursive copy
      console.log(`Source is a directory, using recursive copy`);
      
      // 1. Create destination directory
      try {
        await createDirectory(normalizedDest);
      } catch (createError) {
        // Directory might already exist, that's okay
        if (!createError.message.includes('already exists')) {
          throw createError;
        }
      }
      
      // 2. List all items in source directory
      const sourceItems = await listDirectory(normalizedSource);
      
      // 3. Recursively copy each item
      for (const item of sourceItems) {
        const sourceItemPath = item.filename || `${normalizedSource}/${item.basename}`;
        const destItemPath = `${normalizedDest}/${item.basename}`;
        
        // Recursively copy each item
        await copyFile(sourceItemPath, destItemPath);
      }
      
      console.log(`Successfully copied (recursive) directory from ${normalizedSource} to ${normalizedDest}`);
      return { success: true };
    } else {
      // File copy: Download -> Upload
      // Use manual copy instead of client.copyFile to avoid WebDAV proxy/port/redirect issues (502 errors)
      // This is slower but 100% reliable in complex proxy environments.
      
      console.log(`Copying file from ${normalizedSource} to ${normalizedDest} (Manual Mode)`);

      try {
        // Get file size first for accurate progress tracking
        let fileSize = 0;
        try {
          const parentPath = normalizedSource.substring(0, normalizedSource.lastIndexOf('/')) || '/';
          const fileName = normalizedSource.substring(normalizedSource.lastIndexOf('/') + 1);
          const items = await listDirectory(parentPath);
          const fileItem = items.find(item => item.basename === fileName);
          if (fileItem && fileItem.size) {
            fileSize = fileItem.size;
          }
        } catch (err) {
          // Ignore error
        }

        // Use our wrapper functions to ensure proper path handling
        console.log(`[Copy] Reading source file: ${normalizedSource}`);
        if (progressCallback && fileSize > 0) {
          progressCallback({ stage: 'downloading', progress: 0, total: fileSize });
        }
        const buffer = await getFileContents(normalizedSource);
        console.log(`[Copy] Read ${buffer.length} bytes from ${normalizedSource}`);
        if (progressCallback && fileSize > 0) {
          progressCallback({ stage: 'downloading', progress: buffer.length, total: fileSize });
        }
        
        console.log(`[Copy] Writing to destination: ${normalizedDest}`);
        if (progressCallback && fileSize > 0) {
          progressCallback({ stage: 'uploading', progress: buffer.length, total: fileSize });
        }
        await putFileContents(normalizedDest, buffer);
        console.log(`[Copy] Wrote ${buffer.length} bytes to ${normalizedDest}`);
        
        if (progressCallback && fileSize > 0) {
          progressCallback({ stage: 'completed', progress: fileSize, total: fileSize });
        }
      } catch (manualError) {
        console.error('Manual copy failed:', manualError);
        throw manualError;
      }

      console.log(`Successfully copied (manual) file from ${normalizedSource} to ${normalizedDest}`);
      return { success: true };
    }
  } catch (error) {
    console.error('Copy file error details:', {
      sourcePath,
      destinationPath,
      error: error.message,
      status: error.status,
      response: error.response
    });
    
    if (error.message.includes('does not exist') || error.message.includes('already exists')) {
      throw error;
    }
    
    if (error.status === 502 || error.response?.status === 502) {
      throw new Error('WebDAV server is not responding. Please check if the WebDAV server is running and accessible.');
    }
    
    if (error.message.includes('ECONNREFUSED')) {
      throw new Error('Cannot connect to WebDAV server. Please check the WEBDAV_URL in your .env file.');
    }
    
    throw new Error(`Failed to copy file: ${error.message}`);
  }
}

async function createDirectory(path) {
  const client = getWebDAVClient();
  try {
    // Normalize path - remove trailing slash except for root
    let normalizedPath = path.trim();
    if (normalizedPath.endsWith('/') && normalizedPath !== '/') {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
    
    await client.createDirectory(normalizedPath);
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to create directory: ${error.message}`);
  }
}

function isImageFile(filename) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return imageExtensions.includes(ext);
}

function isVideoFile(filename) {
  const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return videoExtensions.includes(ext);
}

// Test WebDAV connection
async function testConnection() {
  try {
    const client = getWebDAVClient();
    
    // Try different path formats
    const baseUrl = process.env.WEBDAV_URL?.trim() || '';
    let testPaths = ['/'];
    
    // If URL contains a path, try empty string
    if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
      testPaths = ['', '/'];
    }
    
    let lastError = null;
    for (const testPath of testPaths) {
      try {
        const items = await client.getDirectoryContents(testPath);
        return { 
          success: true, 
          message: `WebDAV connection successful (path: "${testPath || '/'}")`,
          itemCount: items.length,
          testPath: testPath || '/'
        };
      } catch (err) {
        lastError = err;
      }
    }
    
    throw lastError || new Error('All connection attempts failed');
  } catch (error) {
    const status = error.status || error.response?.status;
    let message = `WebDAV connection failed: ${error.message}`;
    
    if (status === 401) {
      message = `WebDAV authentication failed (401 Unauthorized).

Troubleshooting:
1. Verify username and password in .env file are correct
2. Check if WebDAV server requires URL format: https://server.com/username
3. Try setting WEBDAV_AUTH_TYPE=basic or WEBDAV_AUTH_TYPE=digest in .env
4. Some servers require the username in the URL path instead of auth header

Current URL: ${process.env.WEBDAV_URL}
Current Username: ${process.env.WEBDAV_USERNAME}`;
    } else if (status === 404) {
      message = 'WebDAV path not found. Please check your WEBDAV_URL in .env file.';
    } else if (status === 403) {
      message = 'WebDAV access forbidden. Please check your permissions.';
    }
    
    return { 
      success: false, 
      message,
      status,
      error: error.message,
    };
  }
}

async function pathExists(path) {
  const client = getWebDAVClient();
  try {
    // Normalize path
    let normalizedPath = path.trim();
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
    
    // Remove trailing slash for non-root paths
    if (normalizedPath.endsWith('/') && normalizedPath !== '/') {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    
    console.log('[WebDAV] Checking if path exists:', normalizedPath);
    
    // Use exists() method to check both files and directories
    try {
      const exists = await client.exists(normalizedPath);
      console.log('[WebDAV] Path exists:', exists);
      return exists;
    } catch (existsError) {
      // If exists() fails, try alternative method: get parent directory and check if item is in it
      try {
        const parentDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) || '/';
        const filename = normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1);
        const items = await client.getDirectoryContents(parentDir);
        const itemExists = items.some(item => item.basename === filename);
        console.log('[WebDAV] Path exists (via directory listing):', itemExists);
        return itemExists;
      } catch (listError) {
        // If both methods fail, assume it doesn't exist
        console.log('[WebDAV] Path exists: false (check failed)');
        return false;
      }
    }
  } catch (error) {
    console.error('[WebDAV] Path exists check error:', error.message);
    console.error('[WebDAV] Error type:', error.constructor.name);
    throw error;
  }
}

module.exports = {
  getWebDAVClient,
  resetWebDAVClient,
  listDirectory,
  getFileContents,
  putFileContents,
  deleteFile,
  moveFile,
  copyFile,
  createDirectory,
  pathExists,
  isImageFile,
  isVideoFile,
  testConnection,
};

 
