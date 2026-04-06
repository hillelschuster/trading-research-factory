# prop_firm_trading_bot/src/data_handler/cache.py

"""
Data caching implementations for market data storage and retrieval.

This module provides concrete implementations for data caching operations
with different storage backends and eviction policies.
"""

import pandas as pd
import pickle
import hashlib
import time
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import logging
from datetime import datetime, timedelta

from src.data_handler.interfaces import DataCache
from src.exceptions import (
    DataProcessingError, DataLoadingError, create_error_context
)
from src.utils.file_utils import ensure_directory_exists, safe_file_write, safe_file_read
from src.utils.pandas_optimization import memory_usage_report


class MemoryCache(DataCache):
    """
    In-memory data cache with LRU eviction policy.
    
    This cache stores DataFrames in memory for fast access
    with configurable size limits and TTL.
    """
    
    def __init__(self, max_size: int = 100, ttl_seconds: int = 3600):
        """
        Initialize memory cache.
        
        Args:
            max_size: Maximum number of items to cache
            ttl_seconds: Time-to-live for cached items in seconds
        """
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self.cache = {}  # key -> (data, metadata, timestamp, access_count)
        self.access_order = []  # LRU tracking
        self.logger = logging.getLogger(__name__)
    
    def store(
        self,
        key: str,
        data: pd.DataFrame,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Store data in memory cache."""
        try:
            if metadata is None:
                metadata = {}
            
            # Add memory usage to metadata
            memory_info = memory_usage_report(data)
            metadata['memory_mb'] = memory_info['total_memory_mb']
            metadata['shape'] = data.shape
            
            current_time = time.time()
            
            # Remove existing entry if present
            if key in self.cache:
                self.access_order.remove(key)
            
            # Add new entry
            self.cache[key] = (data.copy(), metadata, current_time, 1)
            self.access_order.append(key)
            
            # Evict if necessary
            self._evict_if_needed()
            
            self.logger.debug(f"Stored data in cache: {key} ({memory_info['total_memory_mb']:.2f} MB)")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to store data in cache: {key} - {e}")
            return False
    
    def retrieve(self, key: str) -> Optional[pd.DataFrame]:
        """Retrieve data from memory cache."""
        try:
            if key not in self.cache:
                return None
            
            data, metadata, timestamp, access_count = self.cache[key]
            
            # Check TTL
            if time.time() - timestamp > self.ttl_seconds:
                self.invalidate(key)
                return None
            
            # Update access tracking
            self.access_order.remove(key)
            self.access_order.append(key)
            self.cache[key] = (data, metadata, timestamp, access_count + 1)
            
            self.logger.debug(f"Retrieved data from cache: {key}")
            return data.copy()
            
        except Exception as e:
            self.logger.error(f"Failed to retrieve data from cache: {key} - {e}")
            return None
    
    def invalidate(self, key: str) -> bool:
        """Invalidate cached data."""
        try:
            if key in self.cache:
                del self.cache[key]
                self.access_order.remove(key)
                self.logger.debug(f"Invalidated cache entry: {key}")
                return True
            return False
            
        except Exception as e:
            self.logger.error(f"Failed to invalidate cache entry: {key} - {e}")
            return False
    
    def clear_all(self) -> bool:
        """Clear all cached data."""
        try:
            self.cache.clear()
            self.access_order.clear()
            self.logger.info("Cleared all cache entries")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to clear cache: {e}")
            return False
    
    def get_cache_info(self) -> Dict[str, Any]:
        """Get information about the cache state."""
        try:
            total_memory = sum(
                metadata.get('memory_mb', 0) 
                for _, metadata, _, _ in self.cache.values()
            )
            
            expired_count = sum(
                1 for _, _, timestamp, _ in self.cache.values()
                if time.time() - timestamp > self.ttl_seconds
            )
            
            return {
                "cache_type": "Memory",
                "total_entries": len(self.cache),
                "max_size": self.max_size,
                "total_memory_mb": total_memory,
                "ttl_seconds": self.ttl_seconds,
                "expired_entries": expired_count,
                "hit_rate": self._calculate_hit_rate(),
                "entries": list(self.cache.keys())
            }
            
        except Exception as e:
            self.logger.error(f"Failed to get cache info: {e}")
            return {"error": str(e)}
    
    def _evict_if_needed(self):
        """Evict least recently used items if cache is full."""
        while len(self.cache) > self.max_size:
            if self.access_order:
                lru_key = self.access_order[0]
                self.invalidate(lru_key)
                self.logger.debug(f"Evicted LRU entry: {lru_key}")
    
    def _calculate_hit_rate(self) -> float:
        """Calculate cache hit rate based on access counts."""
        if not self.cache:
            return 0.0
        
        total_accesses = sum(access_count for _, _, _, access_count in self.cache.values())
        return min(1.0, total_accesses / len(self.cache)) if total_accesses > 0 else 0.0


class FileCache(DataCache):
    """
    File-based data cache with persistent storage.
    
    This cache stores DataFrames as files on disk for
    persistence across application restarts.
    """
    
    def __init__(self, cache_directory: str, max_files: int = 1000):
        """
        Initialize file cache.
        
        Args:
            cache_directory: Directory to store cache files
            max_files: Maximum number of cache files to maintain
        """
        self.cache_directory = Path(cache_directory)
        self.max_files = max_files
        self.logger = logging.getLogger(__name__)
        
        # Ensure cache directory exists
        ensure_directory_exists(self.cache_directory)
        
        # Load metadata index
        self.metadata_file = self.cache_directory / "cache_metadata.json"
        self.metadata = self._load_metadata()
    
    def store(
        self,
        key: str,
        data: pd.DataFrame,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Store data in file cache."""
        try:
            if metadata is None:
                metadata = {}
            
            # Generate file hash for key
            file_hash = hashlib.md5(key.encode()).hexdigest()
            file_path = self.cache_directory / f"{file_hash}.pkl"
            
            # Add metadata
            metadata.update({
                'key': key,
                'file_path': str(file_path),
                'timestamp': time.time(),
                'shape': data.shape,
                'size_bytes': data.memory_usage(deep=True).sum()
            })
            
            # Save data to file
            success = safe_file_write(file_path, data, file_format='pickle')
            
            if success:
                # Update metadata index
                self.metadata[key] = metadata
                self._save_metadata()
                
                # Evict old files if necessary
                self._evict_if_needed()
                
                self.logger.debug(f"Stored data in file cache: {key}")
                return True
            
            return False
            
        except Exception as e:
            self.logger.error(f"Failed to store data in file cache: {key} - {e}")
            return False
    
    def retrieve(self, key: str) -> Optional[pd.DataFrame]:
        """Retrieve data from file cache."""
        try:
            if key not in self.metadata:
                return None
            
            metadata = self.metadata[key]
            file_path = Path(metadata['file_path'])
            
            if not file_path.exists():
                # Clean up stale metadata
                del self.metadata[key]
                self._save_metadata()
                return None
            
            # Load data from file
            data = safe_file_read(file_path, file_format='pickle')
            
            if data is not None:
                # Update access time
                metadata['last_access'] = time.time()
                self._save_metadata()
                
                self.logger.debug(f"Retrieved data from file cache: {key}")
                return data
            
            return None
            
        except Exception as e:
            self.logger.error(f"Failed to retrieve data from file cache: {key} - {e}")
            return None
    
    def invalidate(self, key: str) -> bool:
        """Invalidate cached data."""
        try:
            if key not in self.metadata:
                return False
            
            metadata = self.metadata[key]
            file_path = Path(metadata['file_path'])
            
            # Remove file
            if file_path.exists():
                file_path.unlink()
            
            # Remove from metadata
            del self.metadata[key]
            self._save_metadata()
            
            self.logger.debug(f"Invalidated file cache entry: {key}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to invalidate file cache entry: {key} - {e}")
            return False
    
    def clear_all(self) -> bool:
        """Clear all cached data."""
        try:
            # Remove all cache files
            for file_path in self.cache_directory.glob("*.pkl"):
                file_path.unlink()
            
            # Clear metadata
            self.metadata.clear()
            self._save_metadata()
            
            self.logger.info("Cleared all file cache entries")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to clear file cache: {e}")
            return False
    
    def get_cache_info(self) -> Dict[str, Any]:
        """Get information about the cache state."""
        try:
            total_size = sum(
                metadata.get('size_bytes', 0) 
                for metadata in self.metadata.values()
            )
            
            return {
                "cache_type": "File",
                "total_entries": len(self.metadata),
                "max_files": self.max_files,
                "total_size_mb": total_size / (1024 * 1024),
                "cache_directory": str(self.cache_directory),
                "entries": list(self.metadata.keys())
            }
            
        except Exception as e:
            self.logger.error(f"Failed to get file cache info: {e}")
            return {"error": str(e)}
    
    def _load_metadata(self) -> Dict[str, Any]:
        """Load metadata index from file."""
        try:
            if self.metadata_file.exists():
                return safe_file_read(self.metadata_file, file_format='json', default={})
            return {}
        except Exception as e:
            self.logger.warning(f"Failed to load cache metadata: {e}")
            return {}
    
    def _save_metadata(self) -> bool:
        """Save metadata index to file."""
        try:
            return safe_file_write(self.metadata_file, self.metadata, file_format='json')
        except Exception as e:
            self.logger.error(f"Failed to save cache metadata: {e}")
            return False
    
    def _evict_if_needed(self):
        """Evict oldest files if cache exceeds max_files."""
        if len(self.metadata) <= self.max_files:
            return
        
        # Sort by timestamp and remove oldest
        sorted_entries = sorted(
            self.metadata.items(),
            key=lambda x: x[1].get('timestamp', 0)
        )
        
        entries_to_remove = len(self.metadata) - self.max_files
        for key, _ in sorted_entries[:entries_to_remove]:
            self.invalidate(key)
            self.logger.debug(f"Evicted old file cache entry: {key}")
