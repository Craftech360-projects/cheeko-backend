package xiaozhi.modules.textbook.controller;

import xiaozhi.modules.textbook.entity.Textbook;
import xiaozhi.modules.textbook.entity.TextbookChunk;
import xiaozhi.modules.textbook.service.TextbookService;
import xiaozhi.modules.textbook.repository.TextbookRepository;
import xiaozhi.modules.textbook.repository.TextbookChunkRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.*;

@RestController
@RequestMapping("/api/textbooks")
@CrossOrigin(originPatterns = "*", allowedHeaders = "*", allowCredentials = "true")
public class TextbookController {
    
    private static final Logger logger = LoggerFactory.getLogger(TextbookController.class);

    @Autowired
    private TextbookService textbookService;
    
    @Autowired
    private TextbookRepository textbookRepository;
    
    @Autowired
    private TextbookChunkRepository textbookChunkRepository;

    /**
     * Upload a new textbook PDF file
     */
    @PostMapping("/upload")
    public ResponseEntity<?> uploadTextbook(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String grade,
            @RequestParam(required = false) String subject,
            @RequestParam(required = false) String language,
            @RequestParam(required = false) String createdBy) {
        
        try {
            // Validate file
            if (file.isEmpty()) {
                return ResponseEntity.badRequest()
                    .body(createErrorResponse("File is empty"));
            }
            
            if (!file.getContentType().equals("application/pdf")) {
                return ResponseEntity.badRequest()
                    .body(createErrorResponse("Only PDF files are supported"));
            }
            
            if (file.getSize() > 50 * 1024 * 1024) { // 50MB limit
                return ResponseEntity.badRequest()
                    .body(createErrorResponse("File size cannot exceed 50MB"));
            }

            Textbook textbook = textbookService.uploadTextbook(file, grade, subject, language, createdBy);
            
            return ResponseEntity.ok(createSuccessResponse("Textbook uploaded successfully", textbook));
            
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Upload failed: " + e.getMessage()));
        }
    }

    /**
     * Get all textbooks with optional filtering and pagination
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> getTextbooks(
            @RequestParam(required = false) String grade,
            @RequestParam(required = false) String subject,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "desc") String sortDir) {
        
        try {
            // Create Sort object
            Sort.Direction direction = sortDir.equalsIgnoreCase("desc") ? 
                Sort.Direction.DESC : Sort.Direction.ASC;
            Sort sort = Sort.by(direction, sortBy);
            Pageable pageable = PageRequest.of(page, size, sort);
            
            Page<Textbook> textbooksPage = textbookService.getTextbooks(grade, subject, status, search, pageable);
            
            Map<String, Object> response = new HashMap<>();
            response.put("content", textbooksPage.getContent());
            response.put("currentPage", textbooksPage.getNumber());
            response.put("totalItems", textbooksPage.getTotalElements());
            response.put("totalPages", textbooksPage.getTotalPages());
            response.put("pageSize", textbooksPage.getSize());
            response.put("hasNext", textbooksPage.hasNext());
            response.put("hasPrevious", textbooksPage.hasPrevious());
            
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("error", "Failed to fetch textbooks: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
        }
    }

    /**
     * Get a specific textbook by ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getTextbook(@PathVariable Long id) {
        try {
            return textbookService.getTextbook(id)
                    .map(textbook -> ResponseEntity.ok(createSuccessResponse("Textbook found", textbook)))
                    .orElse(ResponseEntity.notFound().build());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch textbook: " + e.getMessage()));
        }
    }

    /**
     * Start processing a textbook (extract text, generate embeddings, upload to Qdrant)
     */
    @PostMapping("/{id}/process")
    public ResponseEntity<?> processTextbook(@PathVariable Long id) {
        try {
            textbookService.processTextbook(id);
            return ResponseEntity.ok(createSuccessResponse("Processing started successfully", null));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Processing failed: " + e.getMessage()));
        }
    }

    /**
     * Delete a textbook and all its associated data
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTextbook(@PathVariable Long id) {
        try {
            textbookService.deleteTextbook(id);
            return ResponseEntity.ok(createSuccessResponse("Textbook deleted successfully", null));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Delete failed: " + e.getMessage()));
        }
    }

    /**
     * Get all chunks for a specific textbook
     */
    @GetMapping("/{id}/chunks")
    public ResponseEntity<?> getTextbookChunks(@PathVariable Long id) {
        try {
            List<TextbookChunk> chunks = textbookService.getTextbookChunks(id);
            return ResponseEntity.ok(createSuccessResponse("Chunks retrieved successfully", chunks));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch chunks: " + e.getMessage()));
        }
    }

    /**
     * Get overview statistics for the dashboard
     */
    @GetMapping("/stats/overview")
    public ResponseEntity<?> getStatsOverview() {
        try {
            Map<String, Object> stats = textbookService.getStatsOverview();
            return ResponseEntity.ok(createSuccessResponse("Statistics retrieved successfully", stats));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch statistics: " + e.getMessage()));
        }
    }
    
    /**
     * Get general statistics (alias for overview)
     */
    @GetMapping("/stats")
    public ResponseEntity<?> getStats() {
        try {
            Map<String, Object> stats = textbookService.getStatsOverview();
            return ResponseEntity.ok(createSuccessResponse("Statistics retrieved successfully", stats));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch statistics: " + e.getMessage()));
        }
    }

    /**
     * Get detailed usage statistics with filtering
     */
    @GetMapping("/stats/usage")
    public ResponseEntity<?> getUsageStats(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(required = false) String grade,
            @RequestParam(required = false) String subject) {
        try {
            List<Map<String, Object>> stats = textbookService.getUsageStats(startDate, endDate, grade, subject);
            return ResponseEntity.ok(createSuccessResponse("Usage statistics retrieved successfully", stats));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch usage statistics: " + e.getMessage()));
        }
    }

    /**
     * Update textbook metadata
     */
    @PutMapping("/{id}/metadata")
    public ResponseEntity<?> updateTextbookMetadata(
            @PathVariable Long id,
            @RequestBody Map<String, String> metadata) {
        try {
            Textbook textbook = textbookService.updateMetadata(id, metadata);
            return ResponseEntity.ok(createSuccessResponse("Metadata updated successfully", textbook));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Update failed: " + e.getMessage()));
        }
    }

    /**
     * Bulk process multiple textbooks
     */
    @PostMapping("/bulk-process")
    public ResponseEntity<?> bulkProcessTextbooks(@RequestBody List<Long> textbookIds) {
        try {
            if (textbookIds == null || textbookIds.isEmpty()) {
                return ResponseEntity.badRequest()
                    .body(createErrorResponse("No textbook IDs provided"));
            }
            
            textbookService.bulkProcessTextbooks(textbookIds);
            return ResponseEntity.ok(createSuccessResponse(
                "Bulk processing started for " + textbookIds.size() + " textbooks", null));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Bulk processing failed: " + e.getMessage()));
        }
    }

    /**
     * Search textbook content using RAG
     */
    @GetMapping("/search")
    public ResponseEntity<?> searchTextbookContent(
            @RequestParam String query,
            @RequestParam(required = false) String grade,
            @RequestParam(required = false) String subject,
            @RequestParam(defaultValue = "5") Integer limit) {
        try {
            if (query == null || query.trim().isEmpty()) {
                return ResponseEntity.badRequest()
                    .body(createErrorResponse("Query parameter is required"));
            }
            
            List<Map<String, Object>> results = textbookService.searchContent(query, grade, subject, limit);
            return ResponseEntity.ok(createSuccessResponse("Search completed successfully", results));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Search failed: " + e.getMessage()));
        }
    }

    /**
     * Get textbook processing status
     */
    @GetMapping("/{id}/status")
    public ResponseEntity<?> getTextbookStatus(@PathVariable Long id) {
        try {
            Map<String, Object> status = textbookService.getTextbookStatus(id);
            return ResponseEntity.ok(createSuccessResponse("Status retrieved successfully", status));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch status: " + e.getMessage()));
        }
    }

    /**
     * Get processing logs for a textbook
     */
    @GetMapping("/{id}/logs")
    public ResponseEntity<?> getTextbookLogs(@PathVariable Long id) {
        try {
            List<Map<String, Object>> logs = textbookService.getProcessingLogs(id);
            return ResponseEntity.ok(createSuccessResponse("Logs retrieved successfully", logs));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch logs: " + e.getMessage()));
        }
    }

    /**
     * Get available grades and subjects
     */
    @GetMapping("/metadata")
    public ResponseEntity<?> getMetadataOptions() {
        try {
            Map<String, Object> metadata = textbookService.getMetadataOptions();
            return ResponseEntity.ok(createSuccessResponse("Metadata retrieved successfully", metadata));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch metadata: " + e.getMessage()));
        }
    }

    /**
     * Health check endpoint for textbook service
     */
    @GetMapping("/health")
    public ResponseEntity<?> healthCheck() {
        try {
            Map<String, Object> health = textbookService.getHealthStatus();
            return ResponseEntity.ok(createSuccessResponse("Health check completed", health));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(createErrorResponse("Health check failed: " + e.getMessage()));
        }
    }

    /**
     * Retry failed textbook processing
     */
    @PostMapping("/{id}/retry")
    public ResponseEntity<?> retryTextbookProcessing(@PathVariable Long id) {
        try {
            textbookService.retryProcessing(id);
            return ResponseEntity.ok(createSuccessResponse("Retry initiated successfully", null));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Retry failed: " + e.getMessage()));
        }
    }

    // Helper methods for consistent response format
    private Map<String, Object> createSuccessResponse(String message, Object data) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", message);
        response.put("data", data);
        response.put("timestamp", System.currentTimeMillis());
        return response;
    }

    private Map<String, Object> createErrorResponse(String message) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("error", message);
        response.put("timestamp", System.currentTimeMillis());
        return response;
    }
    
    @GetMapping("/pending")
    public ResponseEntity<?> getPendingTextbooks() {
        try {
            List<Textbook> pendingTextbooks = textbookRepository.findByStatusIn(
                Arrays.asList("uploaded", "chunked")
            );
            return ResponseEntity.ok(createSuccessResponse("Pending textbooks retrieved successfully", pendingTextbooks));
        } catch (Exception e) {
            logger.error("Failed to get pending textbooks", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch pending textbooks: " + e.getMessage()));
        }
    }

    /**
     * Get chunks for server-to-server communication (uses server secret auth)
     */
    @GetMapping("/{id}/chunks/server")
    public ResponseEntity<?> getTextbookChunksForServer(@PathVariable Long id) {
        try {
            List<TextbookChunk> chunks = textbookService.getTextbookChunks(id);
            return ResponseEntity.ok(createSuccessResponse("Chunks retrieved successfully", chunks));
        } catch (Exception e) {
            logger.error("Failed to get chunks for textbook: {}", id, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(createErrorResponse("Failed to fetch chunks: " + e.getMessage()));
        }
    }
    
    @PatchMapping("/{id}/status")
    public ResponseEntity<Map<String, Object>> updateTextbookStatus(
            @PathVariable Long id,
            @RequestBody Map<String, Object> statusUpdate) {
        Map<String, Object> response = new HashMap<>();
        
        try {
            Optional<Textbook> optTextbook = textbookRepository.findById(id);
            if (optTextbook.isEmpty()) {
                response.put("success", false);
                response.put("message", "Textbook not found");
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
            }
            
            Textbook textbook = optTextbook.get();
            String status = (String) statusUpdate.get("status");
            if (status != null) {
                textbook.setStatus(status);
            }
            
            textbookRepository.save(textbook);
            
            response.put("success", true);
            response.put("message", "Status updated successfully");
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            logger.error("Failed to update textbook status", e);
            response.put("success", false);
            response.put("error", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }
    
    @PatchMapping("/chunks/status")
    public ResponseEntity<Map<String, Object>> updateChunkStatus(
            @RequestBody Map<String, Object> statusUpdate) {
        Map<String, Object> response = new HashMap<>();
        
        try {
            @SuppressWarnings("unchecked")
            List<Object> chunkIdsRaw = (List<Object>) statusUpdate.get("chunk_ids");
            String status = (String) statusUpdate.get("status");
            
            if (chunkIdsRaw == null || status == null) {
                response.put("success", false);
                response.put("message", "Missing chunk_ids or status");
                return ResponseEntity.badRequest().body(response);
            }
            
            // Convert chunk IDs to Long (handles both String and Number types)
            List<Long> chunkIds = new ArrayList<>();
            for (Object rawId : chunkIdsRaw) {
                if (rawId instanceof Number) {
                    chunkIds.add(((Number) rawId).longValue());
                } else if (rawId instanceof String) {
                    chunkIds.add(Long.parseLong((String) rawId));
                } else {
                    logger.warn("Invalid chunk ID type: {}", rawId.getClass().getName());
                    continue;
                }
            }
            
            for (Long chunkId : chunkIds) {
                Optional<TextbookChunk> optChunk = textbookChunkRepository.findById(chunkId);
                if (optChunk.isPresent()) {
                    TextbookChunk chunk = optChunk.get();
                    chunk.setEmbeddingStatus(status);
                    textbookChunkRepository.save(chunk);
                }
            }
            
            response.put("success", true);
            response.put("message", "Chunk status updated successfully");
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            logger.error("Failed to update chunk status", e);
            response.put("success", false);
            response.put("error", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }
    
    @GetMapping("/{id}/topics")
    public ResponseEntity<List<Map<String, Object>>> getTextbookTopics(@PathVariable Long id) {
        try {
            Optional<Textbook> optTextbook = textbookRepository.findById(id);
            if (optTextbook.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            
            Textbook textbook = optTextbook.get();
            
            // For now, return generated topics based on content analysis
            // In production, this could cache generated topics or use AI
            List<Map<String, Object>> topics = generateTopicsFromTextbook(textbook);
            
            return ResponseEntity.ok(topics);
            
        } catch (Exception e) {
            logger.error("Failed to get textbook topics", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ArrayList<>());
        }
    }
    
    @PostMapping("/{id}/generate-topics")
    public ResponseEntity<List<Map<String, Object>>> generateTextbookTopics(@PathVariable Long id) {
        try {
            Optional<Textbook> optTextbook = textbookRepository.findById(id);
            if (optTextbook.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            
            Textbook textbook = optTextbook.get();
            List<Map<String, Object>> topics = generateTopicsFromTextbook(textbook);
            
            // In production, you would save these topics to cache or database
            
            return ResponseEntity.ok(topics);
            
        } catch (Exception e) {
            logger.error("Failed to generate textbook topics", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ArrayList<>());
        }
    }
    
    private List<Map<String, Object>> generateTopicsFromTextbook(Textbook textbook) {
        List<Map<String, Object>> topics = new ArrayList<>();
        String subject = textbook.getSubject() != null ? textbook.getSubject().toLowerCase() : "general";
        String grade = textbook.getGrade() != null ? textbook.getGrade() : "5";
        
        // Generate topics based on subject
        switch (subject) {
            case "math":
            case "mathematics":
                topics.addAll(generateMathTopics(grade));
                break;
            case "science":
                topics.addAll(generateScienceTopics(grade));
                break;
            case "english":
                topics.addAll(generateEnglishTopics(grade));
                break;
            case "history":
                topics.addAll(generateHistoryTopics(grade));
                break;
            default:
                topics.addAll(generateGeneralTopics(subject, grade));
                break;
        }
        
        return topics;
    }
    
    private List<Map<String, Object>> generateMathTopics(String grade) {
        List<Map<String, Object>> topics = new ArrayList<>();
        
        topics.add(createTopic(1, "Addition and Subtraction", "Arithmetic", "High", 
            "Basic arithmetic operations for building number sense", 
            Arrays.asList("addition", "subtraction", "carry", "borrow", "numbers"), 15));
            
        topics.add(createTopic(2, "Multiplication Tables", "Arithmetic", "High",
            "Learning multiplication facts and patterns",
            Arrays.asList("multiplication", "times", "factors", "tables"), 28));
            
        topics.add(createTopic(3, "Fractions and Decimals", "Numbers", "Medium",
            "Understanding parts of a whole and decimal representation",
            Arrays.asList("fractions", "decimals", "numerator", "denominator"), 45));
            
        topics.add(createTopic(4, "Geometry Basics", "Geometry", "Medium",
            "Shapes, angles, and spatial relationships",
            Arrays.asList("shapes", "angles", "area", "perimeter", "geometry"), 62));
        
        return topics;
    }
    
    private List<Map<String, Object>> generateScienceTopics(String grade) {
        List<Map<String, Object>> topics = new ArrayList<>();
        
        topics.add(createTopic(1, "Plant Life Cycle", "Biology", "High",
            "How plants grow, reproduce and make their own food",
            Arrays.asList("plants", "photosynthesis", "growth", "seeds", "leaves"), 12));
            
        topics.add(createTopic(2, "Water Cycle", "Earth Science", "High",
            "The continuous movement of water in nature",
            Arrays.asList("water", "evaporation", "condensation", "precipitation", "clouds"), 34));
            
        topics.add(createTopic(3, "Force and Motion", "Physics", "Medium",
            "Understanding how things move and what makes them move",
            Arrays.asList("force", "motion", "gravity", "friction", "speed"), 56));
        
        return topics;
    }
    
    private List<Map<String, Object>> generateEnglishTopics(String grade) {
        List<Map<String, Object>> topics = new ArrayList<>();
        
        topics.add(createTopic(1, "Grammar Fundamentals", "Grammar", "High",
            "Basic sentence structure and parts of speech",
            Arrays.asList("grammar", "sentences", "nouns", "verbs", "adjectives"), 8));
            
        topics.add(createTopic(2, "Reading Comprehension", "Reading", "High",
            "Understanding and analyzing written text",
            Arrays.asList("reading", "comprehension", "stories", "characters", "plot"), 23));
        
        return topics;
    }
    
    private List<Map<String, Object>> generateHistoryTopics(String grade) {
        List<Map<String, Object>> topics = new ArrayList<>();
        
        topics.add(createTopic(1, "Ancient Civilizations", "World History", "High",
            "Early human societies and their achievements",
            Arrays.asList("civilization", "ancient", "culture", "society", "history"), 18));
            
        topics.add(createTopic(2, "Indian Independence", "Indian History", "High",
            "The struggle for freedom from colonial rule",
            Arrays.asList("independence", "freedom", "Gandhi", "colonial", "movement"), 67));
        
        return topics;
    }
    
    private List<Map<String, Object>> generateGeneralTopics(String subject, String grade) {
        List<Map<String, Object>> topics = new ArrayList<>();
        
        topics.add(createTopic(1, "Introduction to " + subject, "Fundamentals", "High",
            "Basic concepts and principles of " + subject,
            Arrays.asList(subject, "basics", "introduction", "concepts"), 5));
            
        topics.add(createTopic(2, "Key Concepts", "Core Knowledge", "Medium",
            "Important ideas and principles in " + subject,
            Arrays.asList("concepts", "principles", "knowledge", subject), 25));
        
        return topics;
    }
    
    private Map<String, Object> createTopic(int id, String title, String category, String importance, 
                                          String description, List<String> keywords, int page) {
        Map<String, Object> topic = new HashMap<>();
        topic.put("id", id);
        topic.put("title", title);
        topic.put("category", category);
        topic.put("importance", importance);
        topic.put("description", description);
        topic.put("keywords", keywords);
        topic.put("page", page);
        topic.put("chapterOrder", id);
        return topic;
    }
}