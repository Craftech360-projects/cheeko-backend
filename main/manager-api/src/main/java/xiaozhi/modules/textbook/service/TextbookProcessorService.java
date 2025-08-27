package xiaozhi.modules.textbook.service;

import xiaozhi.modules.textbook.entity.Textbook;
import xiaozhi.modules.textbook.entity.TextbookChunk;
import xiaozhi.modules.textbook.repository.TextbookChunkRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;
import java.util.regex.Pattern;

@Service
public class TextbookProcessorService {

    private static final Logger logger = LoggerFactory.getLogger(TextbookProcessorService.class);

    @Autowired
    private TextbookChunkRepository chunkRepository;

    @Value("${textbook.upload.directory:./uploadfile/textbooks}")
    private String uploadDirectory;

    @Value("${qdrant.url:}")
    private String qdrantUrl;

    @Value("${qdrant.api-key:}")
    private String qdrantApiKey;

    @Value("${voyage.api-key:}")
    private String voyageApiKey;

    @Value("${textbook.chunk.size:1000}")
    private int chunkSize;

    @Value("${textbook.chunk.overlap:200}")
    private int chunkOverlap;

    @Value("${xiaozhi.python.server.url:http://localhost:8003}")
    private String pythonServerUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    /**
     * Process a textbook: extract text using Python PyMuPDF and create chunks
     * Python RAG service will handle embeddings and Qdrant upload
     */
    public void processTextbook(Textbook textbook) throws Exception {
        logger.info("Starting processing for textbook: {}", textbook.getOriginalFilename());

        // Step 1: Extract text from PDF using Python PyMuPDF service
        String fullText = extractTextFromPDF(textbook);
        if (fullText == null || fullText.trim().isEmpty()) {
            throw new RuntimeException("No text could be extracted from PDF: " + textbook.getOriginalFilename());
        }

        // Step 2: Split text into chunks (using basic chunking for now)
        List<String> chunks = chunkText(fullText);
        logger.info("Extracted {} chunks from textbook: {}", chunks.size(), textbook.getOriginalFilename());

        // Step 3: Save chunks to database
        List<TextbookChunk> chunkEntities = saveChunksToDatabase(textbook.getId(), chunks);

        logger.info("Successfully processed textbook: {} ({} chunks)", 
                   textbook.getOriginalFilename(), chunkEntities.size());
        logger.info("Python RAG service will now handle embeddings and Qdrant upload");
    }

    /**
     * Extract text from PDF using PyMuPDF via Python server
     */
    private String extractTextFromPDF(Textbook textbook) throws Exception {
        String filePath = Paths.get(uploadDirectory, textbook.getFilename()).toString();
        File pdfFile = new File(filePath);

        if (!pdfFile.exists()) {
            throw new RuntimeException("PDF file not found: " + filePath);
        }

        logger.info("Processing PDF with PyMuPDF: {}", textbook.getOriginalFilename());

        try {
            // Prepare multipart request
            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("file", new FileSystemResource(pdfFile));
            body.add("textbook_id", textbook.getId().toString());
            body.add("grade", textbook.getGrade());
            body.add("subject", textbook.getSubject());
            body.add("language", textbook.getLanguage());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            HttpEntity<MultiValueMap<String, Object>> request = new HttpEntity<>(body, headers);

            // Call Python server
            String processingUrl = pythonServerUrl + "/api/pdf/process";
            ResponseEntity<Map> response = restTemplate.postForEntity(processingUrl, request, Map.class);

            if (response.getStatusCode() == HttpStatus.OK) {
                Map<String, Object> result = response.getBody();
                
                if (Boolean.TRUE.equals(result.get("success"))) {
                    // Extract data from PyMuPDF response
                    String extractedText = (String) result.get("text");
                    Map<String, Object> metadata = (Map<String, Object>) result.get("metadata");
                    List<Map<String, Object>> chunks = (List<Map<String, Object>>) result.get("chunks");
                    
                    // Update textbook metadata
                    if (metadata != null) {
                        Integer totalPages = (Integer) metadata.get("total_pages");
                        if (totalPages != null) {
                            textbook.setTotalPages(totalPages);
                        }
                        
                        // Auto-detect language if not set
                        String detectedLang = (String) metadata.get("language");
                        if (detectedLang != null && (textbook.getLanguage() == null || textbook.getLanguage().isEmpty())) {
                            textbook.setLanguage(detectedLang);
                        }
                    }

                    logger.info("PyMuPDF extracted {} characters from {} pages in PDF: {}", 
                               extractedText.length(), textbook.getTotalPages(), textbook.getOriginalFilename());

                    // Log PyMuPDF chunks availability  
                    if (chunks != null && !chunks.isEmpty()) {
                        logger.info("PyMuPDF provided {} intelligent chunks", chunks.size());
                        // Note: For this version, we'll use the full text for chunking
                        // Future enhancement: store PyMuPDF chunks in a dedicated field
                    }

                    return extractedText;
                } else {
                    String error = (String) result.get("error");
                    throw new RuntimeException("PyMuPDF processing failed: " + error);
                }
            } else {
                throw new RuntimeException("Python server returned status: " + response.getStatusCode());
            }

        } catch (Exception e) {
            logger.error("Failed to process PDF with PyMuPDF, falling back to basic text extraction", e);
            
            // Fallback: try to read file as text or return basic error message
            return "Error extracting PDF content: " + e.getMessage() + 
                   "\n\nPlease ensure the xiaozhi Python server is running with PyMuPDF support.";
        }
    }

    /**
     * Clean up extracted PDF text
     */
    private String cleanExtractedText(String text) {
        if (text == null) return "";
        
        // Remove excessive whitespace
        text = text.replaceAll("\\s+", " ");
        
        // Remove page numbers and common headers/footers
        text = text.replaceAll("(?m)^\\s*\\d+\\s*$", "");
        
        // Remove excessive line breaks
        text = text.replaceAll("\\n{3,}", "\\n\\n");
        
        return text.trim();
    }

    /**
     * Split text into overlapping chunks
     */
    private List<String> chunkText(String text) {
        List<String> chunks = new ArrayList<>();
        
        if (text.length() <= chunkSize) {
            chunks.add(text);
            return chunks;
        }

        int start = 0;
        while (start < text.length()) {
            int end = Math.min(start + chunkSize, text.length());
            
            // Try to break at sentence boundaries
            if (end < text.length()) {
                int sentenceEnd = findSentenceEnd(text, start, end);
                if (sentenceEnd > start) {
                    end = sentenceEnd;
                }
            }
            
            String chunk = text.substring(start, end).trim();
            
            // Only add non-empty chunks
            if (!chunk.isEmpty() && chunk.length() > 50) { // Minimum chunk size
                chunks.add(chunk);
            }
            
            // Move start position with overlap
            start = Math.max(start + chunkSize - chunkOverlap, end - chunkOverlap);
        }

        return chunks;
    }

    /**
     * Find the best sentence ending position for clean chunk boundaries
     */
    private int findSentenceEnd(String text, int start, int preferredEnd) {
        // Look for sentence endings near the preferred end
        int searchStart = Math.max(start, preferredEnd - 100);
        int searchEnd = Math.min(text.length(), preferredEnd + 50);
        
        String searchText = text.substring(searchStart, searchEnd);
        
        // Find the last occurrence of sentence-ending punctuation
        Pattern sentenceEnd = Pattern.compile("[.!?]\\s+");
        int lastSentenceEnd = -1;
        
        java.util.regex.Matcher matcher = sentenceEnd.matcher(searchText);
        while (matcher.find()) {
            lastSentenceEnd = matcher.end();
        }
        
        if (lastSentenceEnd > 0) {
            return searchStart + lastSentenceEnd;
        }
        
        return preferredEnd;
    }

    /**
     * Save text chunks to database
     */
    private List<TextbookChunk> saveChunksToDatabase(Long textbookId, List<String> chunks) {
        List<TextbookChunk> chunkEntities = new ArrayList<>();
        
        // Delete existing chunks for this textbook (in case of reprocessing)
        chunkRepository.deleteByTextbookId(textbookId);
        
        for (int i = 0; i < chunks.size(); i++) {
            TextbookChunk chunk = new TextbookChunk();
            chunk.setTextbookId(textbookId);
            chunk.setChunkIndex(i);
            chunk.setContent(chunks.get(i));
            chunk.setEmbeddingStatus("pending");
            
            // Estimate page number (rough approximation)
            chunk.setPageNumber((i * chunkSize / 2000) + 1); // Assuming ~2000 chars per page
            
            TextbookChunk savedChunk = chunkRepository.save(chunk);
            chunkEntities.add(savedChunk);
        }
        
        logger.info("Saved {} chunks to database for textbook ID: {}", chunkEntities.size(), textbookId);
        return chunkEntities;
    }




    /**
     * Delete textbook data from Qdrant
     */
    public void deleteFromQdrant(Textbook textbook) {
        if (qdrantUrl == null || qdrantUrl.trim().isEmpty() || qdrantApiKey == null || qdrantApiKey.trim().isEmpty()) {
            logger.info("Qdrant not configured, skipping deletion from vector database");
            return;
        }

        try {
            // Get all chunks for this textbook
            List<TextbookChunk> chunks = chunkRepository.findByTextbookIdAndEmbeddingStatus(
                textbook.getId(), "uploaded");

            if (chunks.isEmpty()) {
                logger.info("No uploaded chunks found for textbook: {}", textbook.getId());
                return;
            }

            String collectionName = textbook.getQdrantCollection();
            String deleteUrl = qdrantUrl + "/collections/" + collectionName + "/points/delete";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("api-key", qdrantApiKey);

            List<String> pointIds = new ArrayList<>();
            for (TextbookChunk chunk : chunks) {
                if (chunk.getQdrantPointId() != null) {
                    pointIds.add(chunk.getQdrantPointId());
                }
            }

            if (!pointIds.isEmpty()) {
                Map<String, Object> requestBody = new HashMap<>();
                requestBody.put("points", pointIds);

                HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, headers);

                ResponseEntity<String> response = restTemplate.postForEntity(deleteUrl, request, String.class);

                if (response.getStatusCode() == HttpStatus.OK) {
                    logger.info("Successfully deleted {} points from Qdrant for textbook: {}", 
                               pointIds.size(), textbook.getId());
                } else {
                    logger.warn("Qdrant deletion returned status: {} for textbook: {}", 
                               response.getStatusCode(), textbook.getId());
                }
            }

        } catch (Exception e) {
            logger.error("Failed to delete textbook data from Qdrant: {}", textbook.getId(), e);
            // Don't throw exception - deletion from database should continue
        }
    }


    /**
     * Search textbook content - delegated to Python RAG service
     */
    public List<Map<String, Object>> searchTextbookContent(String query, String grade, 
                                                          String subject, Integer limit) {
        logger.info("Search request for query: {} (grade: {}, subject: {})", query, grade, subject);
        logger.info("Note: RAG search is handled by Python service via function calling");
        
        // This is a placeholder - actual RAG search happens in Python service
        // The search_textbook function in Python handles the full RAG pipeline
        
        return new ArrayList<>(); // Return empty for now
    }
}