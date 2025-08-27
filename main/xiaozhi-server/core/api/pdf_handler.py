"""
PDF Processing Handler for PyMuPDF Integration
Provides HTTP endpoints for superior PDF text extraction
"""

import json
import logging
from aiohttp import web, FormData
from core.pdf.pymupdf_processor import PyMuPDFProcessor

logger = logging.getLogger(__name__)

class PDFHandler:
    """Handle PDF processing requests from Java manager-api"""
    
    def __init__(self, config: dict):
        self.config = config
        self.processor = PyMuPDFProcessor()
        
    async def handle_process_pdf(self, request):
        """Process uploaded PDF file with PyMuPDF"""
        try:
            # Handle CORS preflight
            if request.method == 'OPTIONS':
                return web.Response(
                    headers={
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                    }
                )
            
            # Validate request
            if not request.content_type.startswith('multipart/form-data'):
                return web.json_response(
                    {'success': False, 'error': 'Multipart form data required'}, 
                    status=400
                )
            
            reader = await request.multipart()
            file_data = None
            filename = None
            metadata = {}
            
            # Parse multipart form data
            async for part in reader:
                if part.name == 'file':
                    filename = part.filename
                    file_data = await part.read()
                elif part.name in ['grade', 'subject', 'language', 'textbook_id']:
                    metadata[part.name] = await part.text()
            
            if not file_data or not filename:
                return web.json_response(
                    {'success': False, 'error': 'No file provided'}, 
                    status=400
                )
            
            # Process with PyMuPDF
            logger.info(f"Processing PDF: {filename} ({len(file_data)} bytes)")
            result = self.processor.process_uploaded_file(file_data, filename)
            
            # Add metadata to result
            if result['success']:
                result['metadata'].update(metadata)
                logger.info(f"Successfully processed {filename}: {len(result['chunks'])} chunks")
            else:
                logger.error(f"Failed to process {filename}: {result.get('error')}")
            
            return web.json_response(result, headers={
                'Access-Control-Allow-Origin': '*'
            })
            
        except Exception as e:
            logger.error(f"PDF processing error: {str(e)}")
            return web.json_response(
                {'success': False, 'error': str(e)}, 
                status=500,
                headers={'Access-Control-Allow-Origin': '*'}
            )
    
    async def handle_health_check(self, request):
        """Health check for PDF processing service"""
        try:
            return web.json_response({
                'status': 'healthy',
                'service': 'PyMuPDF PDF Processor',
                'supported_formats': self.processor.supported_formats
            }, headers={
                'Access-Control-Allow-Origin': '*'
            })
        except Exception as e:
            return web.json_response(
                {'status': 'error', 'error': str(e)}, 
                status=500,
                headers={'Access-Control-Allow-Origin': '*'}
            )