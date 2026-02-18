import { http, HttpResponse } from 'msw';

export const handlers = [
  // 파일 목록 조회
  http.get('/api/files/list', ({ request }) => {
    const url = new URL(request.url);
    const path = url.searchParams.get('path') || '/';
    
    // `fileService.listFiles()` expects an array in `response.data`.
    return HttpResponse.json([
      { 
        basename: 'test.txt', 
        path: `${path}test.txt`.replace('//', '/'), 
        type: 'file', 
        size: 1024, 
        mtime: new Date().toISOString(),
        hasReadPermission: true,
        hasWritePermission: true
      },
      { 
        basename: 'folder', 
        path: `${path}folder`.replace('//', '/'), 
        type: 'directory', 
        mtime: new Date().toISOString(),
        hasReadPermission: true,
        hasWritePermission: true
      },
      { 
        basename: 'image.png', 
        path: `${path}image.png`.replace('//', '/'), 
        type: 'file', 
        size: 2048, 
        mtime: new Date().toISOString(),
        mime: 'image/png',
        hasReadPermission: true,
        hasWritePermission: true
      }
    ]);
  }),
  
  // 파일 업로드
  http.post('/api/files/upload', async () => {
    return HttpResponse.json({ 
      success: true,
      path: '/uploaded-file.txt'
    });
  }),
  
  // 파일 다운로드
  http.get('/api/files/download', () => {
    return new HttpResponse(new Blob(['test content']), {
      headers: { 
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="test.txt"'
      }
    });
  }),
  
  // 다중 파일 다운로드
  http.post('/api/files/download-multiple', () => {
    return new HttpResponse(new Blob(['zip content']), {
      headers: { 
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="files.zip"'
      }
    });
  }),
  
  // 파일 이동
  http.post('/api/files/move', async () => {
    return HttpResponse.json({ success: true });
  }),
  http.put('/api/files/move', async () => {
    return HttpResponse.json({ success: true });
  }),
  
  // 파일 복사
  http.post('/api/files/copy', async () => {
    return HttpResponse.json({ success: true });
  }),
  
  // 파일 삭제
  http.delete('/api/files/delete', () => {
    return HttpResponse.json({ success: true });
  }),
  
  // 파일 이름 변경
  http.post('/api/files/rename', () => {
    return HttpResponse.json({ success: true });
  }),
  http.put('/api/files/rename', () => {
    return HttpResponse.json({ success: true });
  }),
  
  // 폴더 생성
  http.post('/api/folders/create', () => {
    return HttpResponse.json({ success: true });
  }),

  // 권한 확인
  http.get('/api/permissions/check', () => {
    return HttpResponse.json({
      // Backward/forward compatibility: some callers use hasRead/hasWrite,
      // others use canRead/canWrite.
      hasRead: true,
      hasWrite: true,
      canRead: true,
      canWrite: true,
    });
  }),

  // 사용자에게 공유된 폴더 권한 목록
  http.get('/api/permissions/user/:userId', () => {
    // Minimal stub for tests; app code expects an array of permission rows.
    return HttpResponse.json([]);
  }),

  // 최근 파일 목록 조회
  http.get('/api/recent-files', () => {
    return HttpResponse.json([
      {
        path: '/testuser/document.pdf',
        name: 'document.pdf',
        type: 'file',
        lastAccessed: new Date().toISOString(),
      },
      {
        path: '/testuser/image.jpg',
        name: 'image.jpg',
        type: 'file',
        lastAccessed: new Date(Date.now() - 3600000).toISOString(),
      },
    ]);
  }),

  // 최근 파일 추가
  http.post('/api/recent-files', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json([
      {
        path: body.path,
        name: body.name || body.basename,
        type: body.type || 'file',
        lastAccessed: new Date().toISOString(),
      },
      {
        path: '/testuser/document.pdf',
        name: 'document.pdf',
        type: 'file',
        lastAccessed: new Date().toISOString(),
      },
    ]);
  }),

  // 최근 파일 제거
  http.delete('/api/recent-files/:filePath', ({ params }) => {
    const filePath = decodeURIComponent(params.filePath);
    return HttpResponse.json([
      {
        path: '/testuser/document.pdf',
        name: 'document.pdf',
        type: 'file',
        lastAccessed: new Date().toISOString(),
      },
    ]);
  }),

  // 최근 파일 목록 초기화
  http.delete('/api/recent-files', () => {
    return HttpResponse.json({ messageCode: 'serverMessages.recentFiles.clearedSuccess' });
  }),
];

