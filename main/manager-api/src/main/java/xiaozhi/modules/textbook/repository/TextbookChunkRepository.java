package xiaozhi.modules.textbook.repository;

import xiaozhi.modules.textbook.entity.TextbookChunk;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface TextbookChunkRepository extends JpaRepository<TextbookChunk, Long> {
    
    // Find all chunks for a textbook, ordered by chunk index
    List<TextbookChunk> findByTextbookIdOrderByChunkIndex(Long textbookId);
    
    // Find chunk by textbook ID and chunk index
    Optional<TextbookChunk> findByTextbookIdAndChunkIndex(Long textbookId, Integer chunkIndex);
    
    // Count chunks for a textbook
    long countByTextbookId(Long textbookId);
    
    // Find chunks by embedding status
    List<TextbookChunk> findByEmbeddingStatus(String embeddingStatus);
    
    // Count chunks by embedding status
    long countByEmbeddingStatus(String embeddingStatus);
    
    // Find chunks by textbook ID and embedding status
    List<TextbookChunk> findByTextbookIdAndEmbeddingStatus(Long textbookId, String embeddingStatus);
    
    // Find chunk by Qdrant point ID
    Optional<TextbookChunk> findByQdrantPointId(String qdrantPointId);
    
    // Find chunks by page number
    List<TextbookChunk> findByTextbookIdAndPageNumber(Long textbookId, Integer pageNumber);
    
    // Find chunks by chapter title
    List<TextbookChunk> findByTextbookIdAndChapterTitleContainingIgnoreCase(Long textbookId, String chapterTitle);
    
    // Search chunks by content
    @Query("SELECT c FROM TextbookChunk c WHERE c.content LIKE %:searchTerm%")
    List<TextbookChunk> searchByContent(@Param("searchTerm") String searchTerm);
    
    // Search chunks by content within specific textbook
    @Query("SELECT c FROM TextbookChunk c WHERE c.textbookId = :textbookId AND c.content LIKE %:searchTerm%")
    List<TextbookChunk> searchByContentInTextbook(@Param("textbookId") Long textbookId, 
                                                  @Param("searchTerm") String searchTerm);
    
    // Get chunks that need embedding generation
    @Query("SELECT c FROM TextbookChunk c WHERE c.embeddingStatus IN ('pending', 'failed') ORDER BY c.id ASC")
    List<TextbookChunk> findChunksToEmbed();
    
    // Get chunks that need upload to Qdrant
    @Query("SELECT c FROM TextbookChunk c WHERE c.embeddingStatus = 'generated' ORDER BY c.id ASC")
    List<TextbookChunk> findChunksToUpload();
    
    // Count total chunks across all textbooks
    @Query("SELECT COUNT(c) FROM TextbookChunk c")
    long countTotalChunks();
    
    // Count chunks by textbook and status
    @Query("SELECT COUNT(c) FROM TextbookChunk c WHERE c.textbookId = :textbookId AND c.embeddingStatus = :status")
    long countByTextbookIdAndEmbeddingStatus(@Param("textbookId") Long textbookId, 
                                             @Param("status") String status);
    
    // Get chunk statistics
    @Query("SELECT " +
           "COUNT(c) as totalChunks, " +
           "COUNT(CASE WHEN c.embeddingStatus = 'uploaded' THEN 1 END) as uploadedChunks, " +
           "COUNT(CASE WHEN c.embeddingStatus = 'generated' THEN 1 END) as generatedChunks, " +
           "COUNT(CASE WHEN c.embeddingStatus = 'pending' THEN 1 END) as pendingChunks, " +
           "COUNT(CASE WHEN c.embeddingStatus = 'failed' THEN 1 END) as failedChunks " +
           "FROM TextbookChunk c WHERE c.textbookId = :textbookId")
    Object[] getChunkStatisticsForTextbook(@Param("textbookId") Long textbookId);
    
    // Get global chunk statistics
    @Query("SELECT " +
           "COUNT(c) as totalChunks, " +
           "COUNT(CASE WHEN c.embeddingStatus = 'uploaded' THEN 1 END) as uploadedChunks, " +
           "COUNT(CASE WHEN c.embeddingStatus = 'generated' THEN 1 END) as generatedChunks, " +
           "COUNT(CASE WHEN c.embeddingStatus = 'pending' THEN 1 END) as pendingChunks, " +
           "COUNT(CASE WHEN c.embeddingStatus = 'failed' THEN 1 END) as failedChunks " +
           "FROM TextbookChunk c")
    Object[] getGlobalChunkStatistics();
    
    // Find chunks by multiple textbook IDs
    List<TextbookChunk> findByTextbookIdIn(List<Long> textbookIds);
    
    // Delete all chunks for a textbook (cascade will handle this, but explicit method for clarity)
    void deleteByTextbookId(Long textbookId);
    
    // Find chunks with content longer than specified length
    @Query("SELECT c FROM TextbookChunk c WHERE LENGTH(c.content) > :minLength")
    List<TextbookChunk> findChunksLongerThan(@Param("minLength") int minLength);
    
    // Find chunks with content shorter than specified length
    @Query("SELECT c FROM TextbookChunk c WHERE LENGTH(c.content) < :maxLength")
    List<TextbookChunk> findChunksShorterThan(@Param("maxLength") int maxLength);
    
    // Get average content length for a textbook
    @Query("SELECT AVG(LENGTH(c.content)) FROM TextbookChunk c WHERE c.textbookId = :textbookId")
    Double getAverageContentLength(@Param("textbookId") Long textbookId);
    
    // Find chunks by page number range
    @Query("SELECT c FROM TextbookChunk c WHERE c.textbookId = :textbookId AND " +
           "c.pageNumber BETWEEN :startPage AND :endPage ORDER BY c.pageNumber, c.chunkIndex")
    List<TextbookChunk> findByTextbookIdAndPageNumberBetween(@Param("textbookId") Long textbookId,
                                                             @Param("startPage") Integer startPage,
                                                             @Param("endPage") Integer endPage);
    
    // Find first chunk of a textbook
    Optional<TextbookChunk> findFirstByTextbookIdOrderByChunkIndex(Long textbookId);
    
    // Find last chunk of a textbook  
    Optional<TextbookChunk> findFirstByTextbookIdOrderByChunkIndexDesc(Long textbookId);
}