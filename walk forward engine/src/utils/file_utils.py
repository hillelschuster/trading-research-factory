# prop_firm_trading_bot/src/utils/file_utils.py

"""
File I/O and path handling utilities for the trading bot.

This module consolidates common file operations, path handling,
and directory management functions used across multiple components.
"""

import os
import json
import pickle
import csv
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Tuple
import pandas as pd
import yaml
from datetime import datetime
import shutil
import tempfile

from src.exceptions import (
    DataLoadingError, DataProcessingError, create_error_context
)


def ensure_directory_exists(directory_path: Union[str, Path]) -> Path:
    """
    Ensure a directory exists, creating it if necessary.
    
    Args:
        directory_path: Path to the directory
        
    Returns:
        Path object for the directory
        
    Raises:
        DataProcessingError: If directory creation fails
    """
    try:
        path = Path(directory_path)
        path.mkdir(parents=True, exist_ok=True)
        return path
    except Exception as e:
        raise DataProcessingError(
            f"Failed to create directory: {directory_path}",
            context=create_error_context(directory_path=str(directory_path)),
            cause=e
        ) from e


def safe_file_write(
    file_path: Union[str, Path],
    content: Any,
    file_format: str = 'auto',
    backup: bool = True,
    atomic: bool = True
) -> bool:
    """
    Safely write content to a file with backup and atomic operations.
    
    Args:
        file_path: Path to the file
        content: Content to write
        file_format: File format ('json', 'yaml', 'csv', 'pickle', 'text', 'auto')
        backup: Whether to create a backup of existing file
        atomic: Whether to use atomic write (write to temp file first)
        
    Returns:
        True if successful
        
    Raises:
        DataProcessingError: If write operation fails
    """
    try:
        file_path = Path(file_path)
        
        # Ensure parent directory exists
        ensure_directory_exists(file_path.parent)
        
        # Determine file format
        if file_format == 'auto':
            file_format = _detect_file_format(file_path)
        
        # Create backup if requested and file exists
        if backup and file_path.exists():
            backup_path = file_path.with_suffix(f"{file_path.suffix}.backup")
            shutil.copy2(file_path, backup_path)
        
        # Write content
        if atomic:
            # Write to temporary file first, then move
            with tempfile.NamedTemporaryFile(
                mode='w' if file_format != 'pickle' else 'wb',
                dir=file_path.parent,
                delete=False,
                suffix=file_path.suffix
            ) as temp_file:
                temp_path = Path(temp_file.name)
                _write_content_to_file(temp_file, content, file_format)
            
            # Atomic move
            shutil.move(str(temp_path), str(file_path))
        else:
            # Direct write
            mode = 'w' if file_format != 'pickle' else 'wb'
            with open(file_path, mode) as f:
                _write_content_to_file(f, content, file_format)
        
        return True
        
    except Exception as e:
        raise DataProcessingError(
            f"Failed to write file: {file_path}",
            context=create_error_context(
                file_path=str(file_path),
                file_format=file_format,
                backup=backup,
                atomic=atomic
            ),
            cause=e
        ) from e


def safe_file_read(
    file_path: Union[str, Path],
    file_format: str = 'auto',
    default: Any = None,
    encoding: str = 'utf-8'
) -> Any:
    """
    Safely read content from a file.
    
    Args:
        file_path: Path to the file
        file_format: File format ('json', 'yaml', 'csv', 'pickle', 'text', 'auto')
        default: Default value to return if file doesn't exist
        encoding: File encoding for text files
        
    Returns:
        File content or default value
        
    Raises:
        DataLoadingError: If read operation fails
    """
    try:
        file_path = Path(file_path)
        
        if not file_path.exists():
            if default is not None:
                return default
            raise DataLoadingError(
                f"File not found: {file_path}",
                context=create_error_context(file_path=str(file_path))
            )
        
        # Determine file format
        if file_format == 'auto':
            file_format = _detect_file_format(file_path)
        
        # Read content based on format
        if file_format == 'json':
            with open(file_path, 'r', encoding=encoding) as f:
                return json.load(f)
        elif file_format == 'yaml':
            with open(file_path, 'r', encoding=encoding) as f:
                return yaml.safe_load(f)
        elif file_format == 'csv':
            return pd.read_csv(file_path, encoding=encoding)
        elif file_format == 'pickle':
            with open(file_path, 'rb') as f:
                return pickle.load(f)
        elif file_format == 'text':
            with open(file_path, 'r', encoding=encoding) as f:
                return f.read()
        else:
            raise DataLoadingError(
                f"Unsupported file format: {file_format}",
                context=create_error_context(
                    file_path=str(file_path),
                    file_format=file_format
                )
            )
        
    except Exception as e:
        if isinstance(e, DataLoadingError):
            raise
        raise DataLoadingError(
            f"Failed to read file: {file_path}",
            context=create_error_context(
                file_path=str(file_path),
                file_format=file_format,
                encoding=encoding
            ),
            cause=e
        ) from e


def find_files(
    directory: Union[str, Path],
    pattern: str = "*",
    recursive: bool = True,
    file_type: Optional[str] = None
) -> List[Path]:
    """
    Find files matching a pattern in a directory.
    
    Args:
        directory: Directory to search
        pattern: File pattern to match
        recursive: Whether to search recursively
        file_type: Filter by file type ('file', 'dir')
        
    Returns:
        List of matching file paths
    """
    try:
        directory = Path(directory)
        
        if not directory.exists():
            return []
        
        if recursive:
            matches = directory.rglob(pattern)
        else:
            matches = directory.glob(pattern)
        
        # Filter by file type if specified
        if file_type == 'file':
            matches = [p for p in matches if p.is_file()]
        elif file_type == 'dir':
            matches = [p for p in matches if p.is_dir()]
        else:
            matches = list(matches)
        
        return sorted(matches)
        
    except Exception as e:
        raise DataProcessingError(
            f"Failed to find files in directory: {directory}",
            context=create_error_context(
                directory=str(directory),
                pattern=pattern,
                recursive=recursive,
                file_type=file_type
            ),
            cause=e
        ) from e


def get_file_info(file_path: Union[str, Path]) -> Dict[str, Any]:
    """
    Get comprehensive information about a file.
    
    Args:
        file_path: Path to the file
        
    Returns:
        Dictionary with file information
    """
    try:
        file_path = Path(file_path)
        
        if not file_path.exists():
            return {"exists": False, "path": str(file_path)}
        
        stat = file_path.stat()
        
        return {
            "exists": True,
            "path": str(file_path),
            "name": file_path.name,
            "stem": file_path.stem,
            "suffix": file_path.suffix,
            "size_bytes": stat.st_size,
            "size_mb": stat.st_size / (1024 * 1024),
            "created": datetime.fromtimestamp(stat.st_ctime),
            "modified": datetime.fromtimestamp(stat.st_mtime),
            "is_file": file_path.is_file(),
            "is_dir": file_path.is_dir(),
            "parent": str(file_path.parent)
        }
        
    except Exception as e:
        raise DataProcessingError(
            f"Failed to get file info: {file_path}",
            context=create_error_context(file_path=str(file_path)),
            cause=e
        ) from e


def clean_filename(filename: str, replacement: str = "_") -> str:
    """
    Clean a filename by removing or replacing invalid characters.
    
    Args:
        filename: Original filename
        replacement: Character to replace invalid characters with
        
    Returns:
        Cleaned filename
    """
    try:
        # Characters that are invalid in filenames on most systems
        invalid_chars = '<>:"/\\|?*'
        
        cleaned = filename
        for char in invalid_chars:
            cleaned = cleaned.replace(char, replacement)
        
        # Remove leading/trailing whitespace and dots
        cleaned = cleaned.strip(' .')
        
        # Ensure filename is not empty
        if not cleaned:
            cleaned = "unnamed_file"
        
        return cleaned
        
    except Exception as e:
        raise DataProcessingError(
            f"Failed to clean filename: {filename}",
            context=create_error_context(filename=filename, replacement=replacement),
            cause=e
        ) from e


def generate_timestamped_filename(
    base_name: str,
    extension: str = "",
    timestamp_format: str = "%Y%m%d_%H%M%S"
) -> str:
    """
    Generate a filename with timestamp.
    
    Args:
        base_name: Base name for the file
        extension: File extension (with or without dot)
        timestamp_format: Format for timestamp
        
    Returns:
        Timestamped filename
    """
    try:
        timestamp = datetime.now().strftime(timestamp_format)
        
        # Ensure extension starts with dot
        if extension and not extension.startswith('.'):
            extension = f".{extension}"
        
        return f"{base_name}_{timestamp}{extension}"
        
    except Exception as e:
        raise DataProcessingError(
            f"Failed to generate timestamped filename",
            context=create_error_context(
                base_name=base_name,
                extension=extension,
                timestamp_format=timestamp_format
            ),
            cause=e
        ) from e


def copy_file_with_backup(
    source: Union[str, Path],
    destination: Union[str, Path],
    backup_existing: bool = True
) -> bool:
    """
    Copy a file with optional backup of existing destination.
    
    Args:
        source: Source file path
        destination: Destination file path
        backup_existing: Whether to backup existing destination file
        
    Returns:
        True if successful
    """
    try:
        source = Path(source)
        destination = Path(destination)
        
        if not source.exists():
            raise DataLoadingError(
                f"Source file not found: {source}",
                context=create_error_context(source=str(source))
            )
        
        # Ensure destination directory exists
        ensure_directory_exists(destination.parent)
        
        # Backup existing file if requested
        if backup_existing and destination.exists():
            backup_path = destination.with_suffix(f"{destination.suffix}.backup")
            shutil.copy2(destination, backup_path)
        
        # Copy file
        shutil.copy2(source, destination)
        
        return True
        
    except Exception as e:
        if isinstance(e, DataLoadingError):
            raise
        raise DataProcessingError(
            f"Failed to copy file from {source} to {destination}",
            context=create_error_context(
                source=str(source),
                destination=str(destination),
                backup_existing=backup_existing
            ),
            cause=e
        ) from e


def _detect_file_format(file_path: Path) -> str:
    """Detect file format based on extension."""
    suffix = file_path.suffix.lower()
    
    format_map = {
        '.json': 'json',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.csv': 'csv',
        '.pkl': 'pickle',
        '.pickle': 'pickle',
        '.txt': 'text',
        '.log': 'text'
    }
    
    return format_map.get(suffix, 'text')


def _write_content_to_file(file_handle, content: Any, file_format: str) -> None:
    """Write content to file handle based on format."""
    if file_format == 'json':
        from src.utils.stable_io import stable_json_dump
        stable_json_dump(content, file_handle, indent=2, default=str)
    elif file_format == 'yaml':
        yaml.dump(content, file_handle, default_flow_style=False)
    elif file_format == 'csv':
        if isinstance(content, pd.DataFrame):
            from src.utils.stable_io import stable_csv_write
            content = content.sort_index().reindex(sorted(content.columns), axis=1)
            stable_csv_write(content, file_handle, index=False)
        else:
            writer = csv.writer(file_handle)
            if isinstance(content, list) and content:
                if isinstance(content[0], (list, tuple)):
                    writer.writerows(content)
                else:
                    writer.writerow(content)
            else:
                writer.writerow([content])
    elif file_format == 'pickle':
        pickle.dump(content, file_handle)
    elif file_format == 'text':
        file_handle.write(str(content))
    else:
        raise DataProcessingError(
            f"Unsupported file format for writing: {file_format}",
            context=create_error_context(file_format=file_format)
        )
