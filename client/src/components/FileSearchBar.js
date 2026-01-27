import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  TextField,
  InputAdornment,
  IconButton,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Typography,
  Chip,
  Divider,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
  History as HistoryIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useResponsive } from '../hooks/useResponsive';
import { getSearchHistory, addSearchHistory, clearSearchHistory } from '../utils/localStorage';
import { highlightText } from '../utils/searchUtils';

const FileSearchBar = ({ files, onFileClick, onSearchChange, currentPath }) => {
  const { isMobile } = useResponsive();
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [searchHistory, setSearchHistory] = useState([]);

  // 검색 결과 필터링
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }

    const query = searchQuery.toLowerCase().trim();
    return files.filter((file) => {
      const name = (file.basename || file.name || '').toLowerCase();
      return name.includes(query);
    });
  }, [files, searchQuery]);

  // 검색어 변경 핸들러
  const handleSearchChange = useCallback((e) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (onSearchChange) {
      onSearchChange(value);
    }
  }, [onSearchChange]);

  // 검색어 클리어
  const handleClear = useCallback(() => {
    setSearchQuery('');
    if (onSearchChange) {
      onSearchChange('');
    }
  }, [onSearchChange]);

  // 검색 히스토리 로드 (포커스 시)
  useEffect(() => {
    if (isFocused) {
      const history = getSearchHistory();
      setSearchHistory(history);
      if (history.length > 0 && !searchQuery) {
        setShowHistory(true);
      }
    }
  }, [isFocused, searchQuery]);

  // 검색 실행 (히스토리에 추가) - 검색 확정 시점에만 호출
  const handleSearch = useCallback((query) => {
    if (query && query.trim()) {
      addSearchHistory(query.trim());
      // 히스토리 상태 업데이트
      setSearchHistory(getSearchHistory());
    }
    setShowHistory(false);
  }, []);

  // 검색 히스토리에서 선택
  const handleHistorySelect = useCallback((query) => {
    setSearchQuery(query);
    if (onSearchChange) {
      onSearchChange(query);
    }
    handleSearch(query);
  }, [onSearchChange, handleSearch]);


  return (
    <Box sx={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 400 }}>
      <TextField
        fullWidth
        size="small"
        placeholder="파일 검색..."
        value={searchQuery}
        onChange={handleSearchChange}
        onKeyDown={(e) => {
          // Enter 키 입력 시 검색 확정
          if (e.key === 'Enter' && searchQuery.trim()) {
            handleSearch(searchQuery);
          }
        }}
        onFocus={() => {
          setIsFocused(true);
        }}
        onBlur={() => {
          // 히스토리 클릭을 위해 약간의 지연
          setTimeout(() => setIsFocused(false), 200);
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: searchQuery && (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={handleClear}
                edge="end"
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            backgroundColor: 'background.paper',
          },
        }}
      />

      {/* 검색 히스토리 드롭다운 */}
      {isFocused && showHistory && searchHistory.length > 0 && !searchQuery && (
        <Paper
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            mt: 0.5,
            maxHeight: 300,
            overflow: 'auto',
            zIndex: 1300,
            boxShadow: 3,
          }}
        >
          <Box sx={{ p: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              최근 검색
            </Typography>
            <IconButton
              size="small"
              onClick={() => {
                clearSearchHistory();
                setSearchHistory([]);
                setShowHistory(false);
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Divider />
          <List dense>
            {searchHistory.map((query, index) => (
              <ListItem key={index} disablePadding>
                <ListItemButton
                  onClick={() => handleHistorySelect(query)}
                  sx={{ py: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <HistoryIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={query}
                    primaryTypographyProps={{
                      variant: 'body2',
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      {/* 검색 결과 드롭다운 */}
      {isFocused && searchQuery && filteredFiles.length > 0 && (
        <Paper
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            mt: 0.5,
            maxHeight: 400,
            overflow: 'auto',
            zIndex: 1300,
            boxShadow: 3,
          }}
        >
          <Box sx={{ p: 1 }}>
            <Typography variant="caption" color="text.secondary">
              검색 결과: {filteredFiles.length}개
            </Typography>
          </Box>
          <Divider />
          <List dense>
            {filteredFiles.slice(0, 20).map((file, index) => (
              <ListItem key={index} disablePadding>
                <ListItemButton
                  onClick={() => {
                    // 검색 결과 선택 시 히스토리에 추가
                    if (searchQuery.trim()) {
                      handleSearch(searchQuery);
                    }
                    if (onFileClick) {
                      onFileClick(file);
                    }
                    setShowHistory(false);
                    setIsFocused(false);
                  }}
                  sx={{ py: 0.5 }}
                >
                  <ListItemText
                    primary={highlightText(file.basename || file.name, searchQuery)}
                    secondary={
                      <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                        <Chip
                          size="small"
                          label={file.type === 'directory' ? '폴더' : '파일'}
                          variant="outlined"
                        />
                        <Typography variant="caption" color="text.secondary">
                          {file.path}
                        </Typography>
                      </Box>
                    }
                    primaryTypographyProps={{
                      variant: 'body2',
                    }}
                    secondaryTypographyProps={{
                      component: 'div',
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
            {filteredFiles.length > 20 && (
              <>
                <Divider />
                <Box sx={{ p: 1, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">
                    {filteredFiles.length - 20}개 더 있음
                  </Typography>
                </Box>
              </>
            )}
          </List>
        </Paper>
      )}

      {/* 검색 결과 없음 */}
      {isFocused && searchQuery && filteredFiles.length === 0 && (
        <Paper
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            mt: 0.5,
            p: 2,
            zIndex: 1300,
            boxShadow: 3,
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            검색 결과가 없습니다
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default FileSearchBar;
