import React from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from './contexts/AuthContext';
import { MainLayout, PrivateRoute } from './components/layout';
import Login from './pages/Login';
import Register from './pages/Register';
import FileManager from './pages/FileManager';
import MyPage from './pages/MyPage';
import ShareLinkLoader from './pages/ShareLinkLoader';

const theme = createTheme({
  breakpoints: {
    values: {
      xs: 0,      // 모바일 세로
      sm: 600,    // 모바일 가로, 작은 태블릿
      md: 900,    // 태블릿
      lg: 1200,   // 데스크톱
      xl: 1536,   // 대형 데스크톱
    },
  },
  palette: {
    primary: {
      main: '#4167ba',
    },
    secondary: {
      main: '#52c597',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 44, // 터치 타겟 최소 크기
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          minWidth: 44,
          minHeight: 44,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          minHeight: 44, // 터치 타겟 최소 크기
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          minHeight: 56, // 터치 타겟 최소 크기
        },
      },
    },
  },
});

function App() {
  const router = createBrowserRouter(
    [
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      {
        element: <MainLayout />,
        children: [
          {
            path: '/files/*',
            element: (
              <PrivateRoute>
                <FileManager />
              </PrivateRoute>
            ),
          },
          {
            path: '/mypage',
            element: (
              <PrivateRoute>
                <MyPage />
              </PrivateRoute>
            ),
          },
          {
            path: '/admin',
            element: <Navigate to="/mypage" state={{ category: 'admin' }} replace />,
          },
          { path: '/share/:token', element: <ShareLinkLoader /> },
        ],
      },
      { path: '/', element: <Navigate to="/files" replace /> },
    ],
    {}
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;

