"""
PyMuPDF PDF Processing Module for Textbook RAG
Superior PDF text extraction for educational content
"""

import fitz  # PyMuPDF
import logging
from typing import Dict, List, Optional, Tuple
import re
from pathlib import Path
import tempfile
import os

logger = logging.getLogger(__name__)

class PyMuPDFProcessor:
    """Enhanced PDF processor using PyMuPDF for superior text extraction"""
    
    def __init__(self):
        self.supported_formats = ['.pdf']
        
    def extract_text_with_structure(self, file_path: str) -> Dict:
        """
        Extract text from PDF with structure preservation
        Returns structured data with metadata
        """
        try:
            doc = fitz.open(file_path)
            
            result = {
                'success': True,
                'text': '',
                'pages': [],
                'metadata': {
                    'total_pages': doc.page_count,
                    'title': doc.metadata.get('title', ''),
                    'author': doc.metadata.get('author', ''),
                    'subject': doc.metadata.get('subject', ''),
                    'language': self._detect_language_hints(doc),
                    'has_images': False,
                    'has_tables': False
                },
                'chunks': [],
                'error': None
            }
            
            full_text = []
            
            for page_num in range(doc.page_count):
                page = doc[page_num]
                
                # Extract text with font information for better structure
                text_dict = page.get_text("dict")
                page_text = self._process_page_structure(text_dict)
                
                # Check for images and tables
                if page.get_images():
                    result['metadata']['has_images'] = True
                
                if self._has_tables(page_text):
                    result['metadata']['has_tables'] = True
                
                page_info = {
                    'page_number': page_num + 1,
                    'text': page_text,
                    'char_count': len(page_text)
                }
                
                result['pages'].append(page_info)
                full_text.append(page_text)
            
            result['text'] = '\n\n'.join(full_text)
            
            # Generate intelligent chunks
            result['chunks'] = self._create_intelligent_chunks(
                result['text'], 
                result['metadata']
            )
            
            doc.close()
            return result
            
        except Exception as e:
            logger.error(f"PyMuPDF extraction error: {str(e)}")
            return {
                'success': False,
                'text': '',
                'pages': [],
                'metadata': {},
                'chunks': [],
                'error': str(e)
            }
    
    def _process_page_structure(self, text_dict: Dict) -> str:
        """Process page structure to preserve formatting"""
        lines = []
        
        for block in text_dict.get("blocks", []):
            if "lines" in block:  # Text block
                block_lines = []
                
                for line in block["lines"]:
                    line_text = ""
                    for span in line["spans"]:
                        text = span["text"].strip()
                        if text:
                            # Detect headers based on font size
                            font_size = span.get("size", 12)
                            if font_size > 14:
                                text = f"\n## {text}\n"
                            elif font_size > 13:
                                text = f"\n### {text}\n"
                            
                            line_text += text + " "
                    
                    if line_text.strip():
                        block_lines.append(line_text.strip())
                
                if block_lines:
                    lines.append("\n".join(block_lines))
        
        return "\n\n".join(lines)
    
    def _detect_language_hints(self, doc) -> str:
        """Detect language hints from PDF metadata and content"""
        # Check metadata first
        subject = doc.metadata.get('subject', '').lower()
        title = doc.metadata.get('title', '').lower()
        
        # Common Indian education board indicators
        if any(keyword in title + subject for keyword in ['ncert', 'cbse', 'icse']):
            return 'en'  # English medium
        
        if any(keyword in title + subject for keyword in ['hindi', 'हिंदी']):
            return 'hi'
        
        # Default to English for now
        return 'en'
    
    def _has_tables(self, text: str) -> bool:
        """Detect if text contains table-like structures"""
        lines = text.split('\n')
        table_indicators = 0
        
        for line in lines:
            if '\t' in line or '|' in line:
                table_indicators += 1
            if re.search(r'\d+\.\d+|\d+/\d+|\d+%', line):
                table_indicators += 1
        
        return table_indicators > 3
    
    def _create_intelligent_chunks(self, text: str, metadata: Dict, 
                                 chunk_size: int = 512, overlap: int = 50) -> List[Dict]:
        """Create intelligent chunks based on content structure"""
        chunks = []
        
        # Split by paragraphs first
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        
        current_chunk = ""
        chunk_id = 0
        
        for paragraph in paragraphs:
            # If paragraph is too long, split it
            if len(paragraph) > chunk_size:
                # Save current chunk if exists
                if current_chunk:
                    chunks.append({
                        'id': chunk_id,
                        'text': current_chunk.strip(),
                        'char_count': len(current_chunk),
                        'type': 'paragraph_group'
                    })
                    chunk_id += 1
                    current_chunk = ""
                
                # Split long paragraph
                words = paragraph.split()
                temp_chunk = ""
                
                for word in words:
                    if len(temp_chunk + " " + word) > chunk_size:
                        if temp_chunk:
                            chunks.append({
                                'id': chunk_id,
                                'text': temp_chunk.strip(),
                                'char_count': len(temp_chunk),
                                'type': 'split_paragraph'
                            })
                            chunk_id += 1
                            temp_chunk = word
                        else:
                            temp_chunk = word
                    else:
                        temp_chunk += " " + word if temp_chunk else word
                
                if temp_chunk:
                    current_chunk = temp_chunk
            else:
                # Check if adding this paragraph exceeds chunk size
                if len(current_chunk + "\n\n" + paragraph) > chunk_size:
                    if current_chunk:
                        chunks.append({
                            'id': chunk_id,
                            'text': current_chunk.strip(),
                            'char_count': len(current_chunk),
                            'type': 'paragraph_group'
                        })
                        chunk_id += 1
                    current_chunk = paragraph
                else:
                    current_chunk += "\n\n" + paragraph if current_chunk else paragraph
        
        # Add final chunk
        if current_chunk:
            chunks.append({
                'id': chunk_id,
                'text': current_chunk.strip(),
                'char_count': len(current_chunk),
                'type': 'final_group'
            })
        
        return chunks

    def process_uploaded_file(self, file_data: bytes, filename: str) -> Dict:
        """Process uploaded file from Java API"""
        try:
            # Save to temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
                tmp_file.write(file_data)
                tmp_file_path = tmp_file.name
            
            # Process the file
            result = self.extract_text_with_structure(tmp_file_path)
            result['original_filename'] = filename
            
            # Clean up
            os.unlink(tmp_file_path)
            
            return result
            
        except Exception as e:
            logger.error(f"File processing error: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'original_filename': filename
            }