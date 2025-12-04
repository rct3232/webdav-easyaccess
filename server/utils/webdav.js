const { createClient } = require('webdav');

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

async function getFileContents(path) {
  const client = getWebDAVClient();
  try {
    // Normalize path
    let normalizedPath = path.trim();
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
    
    // Remove trailing slash for files
    if (normalizedPath.endsWith('/') && normalizedPath !== '/') {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    
    const buffer = await client.getFileContents(normalizedPath);
    return buffer;
  } catch (error) {
    console.error(`[WebDAV] Error getting file contents for ${path}:`, error);
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

async function moveFile(sourcePath, destinationPath) {
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
    
    // Manual Move Strategy: Download -> Upload -> Delete
    // This is used to bypass complex WebDAV proxy/port/redirect issues (30035 port, 502 errors)
    // It's slower but reliable.
    
    try {
      // 1. Read content
      const buffer = await client.getFileContents(normalizedSource);
      
      // 2. Write to new location
      await client.putFileContents(normalizedDest, buffer);
      
      // 3. Delete original
      await client.deleteFile(normalizedSource);
      
      console.log(`Successfully moved (manual) file from ${normalizedSource} to ${normalizedDest}`);
      return { success: true };
      
    } catch (manualError) {
      console.error('Manual move failed:', manualError);
      throw manualError;
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

async function copyFile(sourcePath, destinationPath) {
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
    
    // Skip pre-checks to avoid redirect issues
    
    // Manual Copy Strategy: Download -> Upload
    // Use manual copy instead of client.copyFile to avoid WebDAV proxy/port/redirect issues (502 errors)
    // This is slower but 100% reliable in complex proxy environments.
    
    console.log(`Copying file from ${normalizedSource} to ${normalizedDest} (Manual Mode)`);

    try {
      const buffer = await client.getFileContents(normalizedSource);
      await client.putFileContents(normalizedDest, buffer);
    } catch (manualError) {
      console.error('Manual copy failed:', manualError);
      throw manualError;
    }

    console.log(`Successfully copied (manual) file from ${normalizedSource} to ${normalizedDest}`);
    return { success: true };
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
    
    // Try to get directory contents instead of using exists()
    // If it succeeds, the directory exists
    try {
      await client.getDirectoryContents(normalizedPath);
      console.log('[WebDAV] Path exists: true (directory found)');
      return true;
    } catch (dirError) {
      // 404 means directory doesn't exist
      if (dirError.status === 404 || dirError.response?.status === 404) {
        console.log('[WebDAV] Path exists: false (404 Not Found)');
        return false;
      }
      // Other errors (like 401, 403) mean we can't determine, so throw
      console.error('[WebDAV] Path check failed with status:', dirError.status || dirError.response?.status);
      throw dirError;
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

 
