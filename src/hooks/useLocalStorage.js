import { useState, useCallback } from 'react';

/**
 * useLocalStorage Hook
 * 在 React state 和 LocalStorage 之间建立双向绑定
 *
 * @param {string} key LocalStorage 键名
 * @param {*} initialValue 初始值
 * @returns {[*, Function]}
 */
function useLocalStorage(key, initialValue) {
  // 惰性初始化：从 LocalStorage 读取或使用初始值
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`useLocalStorage read error for key "${key}":`, error);
      return initialValue;
    }
  });

  // 封装 setState，同时写入 LocalStorage
  const setValue = useCallback(
    (value) => {
      try {
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.error(`useLocalStorage write error for key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  return [storedValue, setValue];
}

export default useLocalStorage;
