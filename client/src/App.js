import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import FileManager from './pages/FileManager';
import MyPage from './pages/MyPage';
import AdminDashboard from './pages/AdminDashboard';

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
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/files/*"
              element={
                <PrivateRoute>
                  <FileManager />
                </PrivateRoute>
              }
            />
            <Route
              path="/mypage"
              element={
                <PrivateRoute>
                  <MyPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <PrivateRoute>
                  <AdminDashboard />
                </PrivateRoute>
              }
            />
            <Route path="/" element={<Navigate to="/files" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;

