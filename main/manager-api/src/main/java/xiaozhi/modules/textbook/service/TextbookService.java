package xiaozhi.modules.textbook.service;

import xiaozhi.modules.textbook.entity.Textbook;
import xiaozhi.modules.textbook.entity.TextbookChunk;
import xiaozhi.modules.textbook.entity.RagUsageStats;
import xiaozhi.modules.textbook.repository.TextbookRepository;
import xiaozhi.modules.textbook.repository.TextbookChunkRepository;
import xiaozhi.modules.textbook.repository.RagUsageStatsRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.*;

@Service
@Transactional
public class TextbookService {

    private static final Logger logger = LoggerFactory.getLogger(TextbookService.class);

    @Autowired
    private TextbookRepository textbookRepository;

    @Autowired
    private TextbookChunkRepository chunkRepository;

    @Autowired
    private RagUsageStatsRepository usageStatsRepository;

    @Autowired
    private TextbookProcessorService processorService;

    @Value("${textbook.upload.directory:./uploadfile/textbooks}")
    private String uploadDirectory;

    @Value("${textbook.max-file-size:52428800}") // 50MB in bytes
    private long maxFileSize;

    /**
     * Upload a new textbook PDF file
     */
    public Textbook uploadTextbook(MultipartFile file, String grade, String subject, 
                                 String language, String createdBy) throws IOException {
        
        logger.info("Starting textbook upload: {}", file.getOriginalFilename());
        
        // Create upload directory if it doesn't exist
        Path uploadPath = Paths.get(uploadDirectory);
        if (!Files.exists(uploadPath)) {
            Files.createDirectories(uploadPath);
            logger.info("Created upload directory: {}", uploadPath.toAbsolutePath());
        }

        // Generate unique filename
        String originalFilename = file.getOriginalFilename();
        String fileExtension = originalFilename.substring(originalFilename.lastIndexOf("."));
        String uniqueFilename = UUID.randomUUID().toString() + "_" + 
            originalFilename.replaceAll("[^a-zA-Z0-9._-]", "_");
        Path filePath = uploadPath.resolve(uniqueFilename);

        // Save file to disk
        file.transferTo(filePath.toFile());
        logger.info("File saved to: {}", filePath.toAbsolutePath());

        // Extract metadata from filename if not provided
        Map<String, String> extractedMetadata = extractMetadataFromFilename(originalFilename);
        if (grade == null || grade.trim().isEmpty()) {
            grade = extractedMetadata.get("grade");
        }
        if (subject == null || subject.trim().isEmpty()) {
            subject = extractedMetadata.get("subject");
        }

        // Create database record
        Textbook textbook = new Textbook();
        textbook.setFilename(uniqueFilename);
        textbook.setOriginalFilename(originalFilename);
        textbook.setGrade(grade);
        textbook.setSubject(subject);
        textbook.setLanguage(language != null ? language : "en");
        textbook.setFileSize(file.getSize());
        textbook.setCreatedBy(createdBy != null ? createdBy : "system");
        textbook.setStatus("uploaded");
        textbook.setQdrantCollection("ncert_textbooks"); // Default collection name

        Textbook savedTextbook = textbookRepository.save(textbook);
        logger.info("Textbook saved to database with ID: {}", savedTextbook.getId());

        // Automatically trigger processing after upload
        logger.info("Auto-triggering processing for uploaded textbook: {}", savedTextbook.getId());
        processTextbook(savedTextbook.getId());

        return savedTextbook;
    }

    /**
     * Get textbooks with filtering and pagination
     */
    public Page<Textbook> getTextbooks(String grade, String subject, String status, 
                                      String search, Pageable pageable) {
        
        if (search != null && !search.trim().isEmpty()) {
            // If search term provided, use search functionality
            List<Textbook> searchResults = textbookRepository.searchTextbooks(search.trim());
            // Convert to Page (simplified - in production, implement proper search pagination)
            return textbookRepository.findAll(pageable);
        }
        
        // Use filtering
        return textbookRepository.findByFilters(grade, subject, status, pageable);
    }

    /**
     * Get a specific textbook by ID
     */
    public Optional<Textbook> getTextbook(Long id) {
        return textbookRepository.findById(id);
    }

    /**
     * Start processing a textbook asynchronously
     */
    @Async
    public void processTextbook(Long id) {
        Optional<Textbook> textbookOpt = textbookRepository.findById(id);
        if (!textbookOpt.isPresent()) {
            logger.error("Textbook not found for processing: {}", id);
            return;
        }

        Textbook textbook = textbookOpt.get();
        logger.info("Starting processing for textbook: {} (ID: {})", textbook.getOriginalFilename(), id);

        try {
            // Update status to processing
            textbook.setStatus("processing");
            textbook.setUpdatedAt(LocalDateTime.now());
            textbookRepository.save(textbook);
            
            // Clear existing chunks if any (for reprocessing)
            long existingChunkCount = chunkRepository.countByTextbookId(id);
            if (existingChunkCount > 0) {
                logger.info("Clearing {} existing chunks for textbook {}", existingChunkCount, id);
                chunkRepository.deleteByTextbookId(id);
            }
            
            // Use TextbookProcessorService to extract text and create chunks using Python PyMuPDF
            processorService.processTextbook(textbook);
            
            // Update status to chunked so Python RAG service can pick it up for embedding/vector upload
            textbook.setStatus("chunked");
            textbook.setUpdatedAt(LocalDateTime.now());
            
            // Update processed chunks count
            long chunkCount = chunkRepository.countByTextbookId(id);
            textbook.setProcessedChunks((int) chunkCount);
            
            logger.info("Successfully extracted and chunked textbook: {} ({} chunks)", 
                       textbook.getOriginalFilename(), chunkCount);
            logger.info("Python RAG service will now generate embeddings and upload to Qdrant");
            
        } catch (Exception e) {
            logger.error("Failed to process textbook: {} - Error: {}", textbook.getOriginalFilename(), e.getMessage(), e);
            
            // Update status to failed
            textbook.setStatus("failed");
            textbook.setUpdatedAt(LocalDateTime.now());
        }
        
        textbookRepository.save(textbook);
    }

    /**
     * Delete a textbook and all its associated data
     */
    public void deleteTextbook(Long id) {
        Optional<Textbook> textbookOpt = textbookRepository.findById(id);
        if (!textbookOpt.isPresent()) {
            throw new RuntimeException("Textbook not found with ID: " + id);
        }

        Textbook textbook = textbookOpt.get();
        logger.info("Deleting textbook: {} (ID: {})", textbook.getOriginalFilename(), id);

        try {
            // Delete physical file
            Path filePath = Paths.get(uploadDirectory, textbook.getFilename());
            Files.deleteIfExists(filePath);
            logger.info("Deleted physical file: {}", filePath);

            // Delete from Qdrant if processed
            if ("processed".equals(textbook.getStatus())) {
                processorService.deleteFromQdrant(textbook);
            }

            // Delete from database (cascades to chunks due to foreign key)
            textbookRepository.delete(textbook);
            logger.info("Successfully deleted textbook from database: {}", id);

        } catch (IOException e) {
            logger.error("Failed to delete physical file for textbook: {}", id, e);
            // Continue with database deletion even if file deletion fails
            textbookRepository.delete(textbook);
        }
    }

    /**
     * Get all chunks for a textbook
     */
    public List<TextbookChunk> getTextbookChunks(Long textbookId) {
        return chunkRepository.findByTextbookIdOrderByChunkIndex(textbookId);
    }

    /**
     * Get statistics overview for dashboard
     */
    public Map<String, Object> getStatsOverview() {
        Map<String, Object> stats = new HashMap<>();
        
        try {
            // Basic counts
            stats.put("totalTextbooks", textbookRepository.count());
            stats.put("processedTextbooks", textbookRepository.countByStatus("processed"));
            stats.put("processingTextbooks", textbookRepository.countByStatus("processing"));
            stats.put("failedTextbooks", textbookRepository.countByStatus("failed"));
            stats.put("totalChunks", chunkRepository.count());
            stats.put("totalQueries", usageStatsRepository.count());
            
            // Grade distribution
            List<Object[]> gradeStats = textbookRepository.countByGrade();
            Map<String, Long> gradeDistribution = new HashMap<>();
            for (Object[] row : gradeStats) {
                String grade = (String) row[0];
                Long count = (Long) row[1];
                if (grade != null) {
                    gradeDistribution.put(grade, count);
                }
            }
            stats.put("gradeDistribution", gradeDistribution);
            
            // Subject distribution
            List<Object[]> subjectStats = textbookRepository.countBySubject();
            Map<String, Long> subjectDistribution = new HashMap<>();
            for (Object[] row : subjectStats) {
                String subject = (String) row[0];
                Long count = (Long) row[1];
                if (subject != null) {
                    subjectDistribution.put(subject, count);
                }
            }
            stats.put("subjectDistribution", subjectDistribution);
            
            // File size statistics
            stats.put("totalFileSize", textbookRepository.getTotalFileSizeByStatus("processed"));
            
            logger.info("Generated statistics overview: {} textbooks, {} chunks", 
                       stats.get("totalTextbooks"), stats.get("totalChunks"));
            
        } catch (Exception e) {
            logger.error("Error generating statistics overview", e);
            throw new RuntimeException("Failed to generate statistics: " + e.getMessage());
        }
        
        return stats;
    }

    /**
     * Get usage statistics with filtering
     */
    public List<Map<String, Object>> getUsageStats(String startDate, String endDate, 
                                                  String grade, String subject) {
        try {
            List<RagUsageStats> stats = usageStatsRepository.getUsageStatistics(startDate, endDate, grade, subject);
            List<Map<String, Object>> result = new ArrayList<>();
            
            for (RagUsageStats stat : stats) {
                Map<String, Object> statMap = new HashMap<>();
                statMap.put("id", stat.getId());
                statMap.put("grade", stat.getGrade());
                statMap.put("subject", stat.getSubject());
                statMap.put("language", stat.getLanguage());
                statMap.put("responseTimeMs", stat.getResponseTimeMs());
                statMap.put("chunksRetrieved", stat.getChunksRetrieved());
                statMap.put("accuracyRating", stat.getAccuracyRating());
                statMap.put("queryDate", stat.getQueryDate());
                statMap.put("deviceId", stat.getDeviceId());
                result.add(statMap);
            }
            
            return result;
            
        } catch (Exception e) {
            logger.error("Error fetching usage statistics", e);
            throw new RuntimeException("Failed to fetch usage statistics: " + e.getMessage());
        }
    }

    /**
     * Update textbook metadata
     */
    public Textbook updateMetadata(Long id, Map<String, String> metadata) {
        Optional<Textbook> textbookOpt = textbookRepository.findById(id);
        if (!textbookOpt.isPresent()) {
            throw new RuntimeException("Textbook not found with ID: " + id);
        }

        Textbook textbook = textbookOpt.get();
        
        if (metadata.containsKey("grade")) {
            textbook.setGrade(metadata.get("grade"));
        }
        if (metadata.containsKey("subject")) {
            textbook.setSubject(metadata.get("subject"));
        }
        if (metadata.containsKey("language")) {
            textbook.setLanguage(metadata.get("language"));
        }
        
        textbook.setUpdatedAt(LocalDateTime.now());
        
        Textbook updated = textbookRepository.save(textbook);
        logger.info("Updated metadata for textbook: {}", id);
        
        return updated;
    }

    /**
     * Bulk process multiple textbooks
     */
    @Async
    public void bulkProcessTextbooks(List<Long> textbookIds) {
        logger.info("Starting bulk processing for {} textbooks", textbookIds.size());
        
        for (Long id : textbookIds) {
            try {
                processTextbook(id);
                // Add small delay to prevent overwhelming the system
                Thread.sleep(1000);
            } catch (Exception e) {
                logger.error("Failed to process textbook {} in bulk operation", id, e);
            }
        }
        
        logger.info("Completed bulk processing for {} textbooks", textbookIds.size());
    }

    /**
     * Search textbook content using RAG
     */
    public List<Map<String, Object>> searchContent(String query, String grade, 
                                                  String subject, Integer limit) {
        try {
            // This will be implemented by TextbookProcessorService
            return processorService.searchTextbookContent(query, grade, subject, limit);
            
        } catch (Exception e) {
            logger.error("Error searching textbook content: {}", query, e);
            throw new RuntimeException("Search failed: " + e.getMessage());
        }
    }

    /**
     * Get textbook processing status with details
     */
    public Map<String, Object> getTextbookStatus(Long id) {
        Optional<Textbook> textbookOpt = textbookRepository.findById(id);
        if (!textbookOpt.isPresent()) {
            throw new RuntimeException("Textbook not found with ID: " + id);
        }

        Textbook textbook = textbookOpt.get();
        Map<String, Object> status = new HashMap<>();
        
        status.put("id", textbook.getId());
        status.put("status", textbook.getStatus());
        status.put("processedChunks", textbook.getProcessedChunks());
        status.put("updatedAt", textbook.getUpdatedAt());
        
        // Get chunk statistics
        Object[] chunkStats = chunkRepository.getChunkStatisticsForTextbook(id);
        if (chunkStats != null) {
            status.put("totalChunks", chunkStats[0]);
            status.put("uploadedChunks", chunkStats[1]);
            status.put("generatedChunks", chunkStats[2]);
            status.put("pendingChunks", chunkStats[3]);
            status.put("failedChunks", chunkStats[4]);
        }
        
        return status;
    }

    /**
     * Get processing logs for a textbook (placeholder - would need processing_logs table)
     */
    public List<Map<String, Object>> getProcessingLogs(Long id) {
        // This would require a processing_logs table
        // For now, return empty list
        return new ArrayList<>();
    }

    /**
     * Get metadata options (grades, subjects, languages)
     */
    public Map<String, Object> getMetadataOptions() {
        Map<String, Object> metadata = new HashMap<>();
        
        // Available grades
        List<String> grades = new ArrayList<>();
        for (int i = 1; i <= 12; i++) {
            grades.add(String.valueOf(i));
        }
        metadata.put("grades", grades);
        
        // Available subjects
        List<String> subjects = Arrays.asList("math", "science", "english", "hindi", "social_studies");
        metadata.put("subjects", subjects);
        
        // Available languages
        List<String> languages = Arrays.asList("en", "hi");
        metadata.put("languages", languages);
        
        return metadata;
    }

    /**
     * Get health status of textbook service
     */
    public Map<String, Object> getHealthStatus() {
        Map<String, Object> health = new HashMap<>();
        
        try {
            // Check database connectivity
            long textbookCount = textbookRepository.count();
            health.put("database", "healthy");
            health.put("totalTextbooks", textbookCount);
            
            // Check upload directory
            Path uploadPath = Paths.get(uploadDirectory);
            boolean uploadDirExists = Files.exists(uploadPath);
            health.put("uploadDirectory", uploadDirExists ? "healthy" : "not_found");
            health.put("uploadDirectoryPath", uploadPath.toAbsolutePath().toString());
            
            // Check external services (would be implemented in TextbookProcessorService)
            health.put("qdrant", "not_checked");
            health.put("voyageAI", "not_checked");
            
            health.put("status", "healthy");
            health.put("timestamp", LocalDateTime.now());
            
        } catch (Exception e) {
            health.put("status", "unhealthy");
            health.put("error", e.getMessage());
            health.put("timestamp", LocalDateTime.now());
        }
        
        return health;
    }

    /**
     * Retry processing for a failed textbook
     */
    public void retryProcessing(Long id) {
        Optional<Textbook> textbookOpt = textbookRepository.findById(id);
        if (!textbookOpt.isPresent()) {
            throw new RuntimeException("Textbook not found with ID: " + id);
        }

        Textbook textbook = textbookOpt.get();
        
        if (!"failed".equals(textbook.getStatus())) {
            throw new RuntimeException("Can only retry failed textbooks. Current status: " + textbook.getStatus());
        }
        
        logger.info("Retrying processing for textbook: {}", textbook.getOriginalFilename());
        
        // Reset status to uploaded so it can be processed again
        textbook.setStatus("uploaded");
        textbook.setUpdatedAt(LocalDateTime.now());
        textbookRepository.save(textbook);
        
        // Start processing
        processTextbook(id);
    }

    /**
     * Extract metadata from filename
     */
    private Map<String, String> extractMetadataFromFilename(String filename) {
        Map<String, String> metadata = new HashMap<>();
        String lowerFilename = filename.toLowerCase();
        
        // Extract grade
        for (int i = 1; i <= 12; i++) {
            if (lowerFilename.contains("class" + i) || lowerFilename.contains("grade" + i) || 
                lowerFilename.contains(i + "th") || lowerFilename.contains(i + "st") || 
                lowerFilename.contains(i + "nd") || lowerFilename.contains(i + "rd")) {
                metadata.put("grade", String.valueOf(i));
                break;
            }
        }
        
        // Extract subject
        Map<String, String[]> subjectKeywords = new HashMap<>();
        subjectKeywords.put("math", new String[]{"math", "mathematics", "algebra", "geometry"});
        subjectKeywords.put("science", new String[]{"science", "physics", "chemistry", "biology"});
        subjectKeywords.put("english", new String[]{"english", "literature", "grammar"});
        subjectKeywords.put("hindi", new String[]{"hindi", "हिंदी"});
        subjectKeywords.put("social_studies", new String[]{"social", "history", "geography", "civics", "economics"});
        
        for (Map.Entry<String, String[]> entry : subjectKeywords.entrySet()) {
            for (String keyword : entry.getValue()) {
                if (lowerFilename.contains(keyword)) {
                    metadata.put("subject", entry.getKey());
                    break;
                }
            }
            if (metadata.containsKey("subject")) break;
        }
        
        return metadata;
    }
}