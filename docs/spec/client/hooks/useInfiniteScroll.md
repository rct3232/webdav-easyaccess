# useInfiniteScroll Spec

## 1. Overview

| Item                     | Description                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Role                     | IntersectionObserver-based infinite scroll. Returns displayedFiles (slice), loadMoreRef, hasMore, reset. |
| Used by components/pages | FileList, FileGrid                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useInfiniteScroll.js`
- **Test file:** `client/src/hooks/__tests__/useInfiniteScroll.test.js`

### 2.2 Input Parameters

| Name    | Type   | Required | Description                                                                   |
| ------- | ------ | -------- | ----------------------------------------------------------------------------- |
| files   | array  | Y        | Full file list                                                                |
| options | object | N        | initialCount (50), incrementCount (50), threshold (0.1), rootMargin ('200px') |

### 2.3 Return Value / State

| Key            | Type       | Meaning                      |
| -------------- | ---------- | ---------------------------- |
| displayedFiles | array      | files.slice(0, displayCount) |
| loadMoreRef    | ref        | Sentinel ref                 |
| hasMore        | boolean    | displayCount < files.length  |
| totalCount     | number     | files.length                 |
| displayedCount | number     | Current count                |
| reset          | () => void | Reset to initial             |

### 2.4 Dependencies

- None (IntersectionObserver)

### 2.5 Side Effects

- IntersectionObserver on loadMoreRef
- loadMore when sentinel intersecting
- displayCount reset when files.length changes (new list)

### 2.6 Error Handling

- None

### 2.7 Verification Scenarios

- [ ] Initial displayedFiles length
- [ ] loadMore increments displayCount
- [ ] hasMore when more items
- [ ] reset
- [ ] files.length change resets

### 2.8 Edge Cases

- files.length < initialCount
- Observer cleanup on unmount
