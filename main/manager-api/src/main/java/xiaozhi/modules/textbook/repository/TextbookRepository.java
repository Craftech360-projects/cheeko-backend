package xiaozhi.modules.textbook.repository;

import xiaozhi.modules.textbook.entity.Textbook;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface TextbookRepository extends JpaRepository<Textbook, Long> {
    
    // Find textbooks by status
    List<Textbook> findByStatus(String status);
    
    // Count textbooks by status
    long countByStatus(String status);
    
    // Find textbooks by grade and subject
    List<Textbook> findByGradeAndSubject(String grade, String subject);
    
    // Find textbooks by grade
    List<Textbook> findByGrade(String grade);
    
    // Find textbooks by subject
    List<Textbook> findBySubject(String subject);
    
    // Find textbooks by filename
    Optional<Textbook> findByFilename(String filename);
    
    // Find textbooks by original filename
    List<Textbook> findByOriginalFilenameContainingIgnoreCase(String originalFilename);
    
    // Custom query for filtering with dynamic conditions
    @Query("SELECT t FROM Textbook t WHERE " +
           "(:grade IS NULL OR t.grade = :grade) AND " +
           "(:subject IS NULL OR t.subject = :subject) AND " +
           "(:status IS NULL OR t.status = :status) " +
           "ORDER BY t.createdAt DESC")
    Page<Textbook> findByFilters(@Param("grade") String grade, 
                                 @Param("subject") String subject, 
                                 @Param("status") String status, 
                                 Pageable pageable);
    
    // Statistics queries
    @Query("SELECT t.grade, COUNT(t) FROM Textbook t GROUP BY t.grade")
    List<Object[]> countByGrade();
    
    @Query("SELECT t.subject, COUNT(t) FROM Textbook t GROUP BY t.subject")
    List<Object[]> countBySubject();
    
    @Query("SELECT t.status, COUNT(t) FROM Textbook t GROUP BY t.status")
    List<Object[]> countByStatusGrouped();
    
    // Find textbooks created within date range
    @Query("SELECT t FROM Textbook t WHERE DATE(t.createdAt) BETWEEN :startDate AND :endDate")
    List<Textbook> findByCreatedAtBetween(@Param("startDate") LocalDate startDate, 
                                          @Param("endDate") LocalDate endDate);
    
    // Find processed textbooks for a subject and grade
    @Query("SELECT t FROM Textbook t WHERE t.status = 'processed' AND " +
           "(:grade IS NULL OR t.grade = :grade) AND " +
           "(:subject IS NULL OR t.subject = :subject)")
    List<Textbook> findProcessedTextbooks(@Param("grade") String grade, 
                                          @Param("subject") String subject);
    
    // Find textbooks that need processing
    @Query("SELECT t FROM Textbook t WHERE t.status IN ('uploaded', 'failed') ORDER BY t.createdAt ASC")
    List<Textbook> findTextbooksToProcess();
    
    // Count total file size by status
    @Query("SELECT COALESCE(SUM(t.fileSize), 0) FROM Textbook t WHERE t.status = :status")
    Long getTotalFileSizeByStatus(@Param("status") String status);
    
    // Find textbooks with processing errors
    @Query("SELECT t FROM Textbook t WHERE t.status = 'failed' ORDER BY t.updatedAt DESC")
    List<Textbook> findFailedTextbooks();
    
    // Find textbooks by created by user
    List<Textbook> findByCreatedByOrderByCreatedAtDesc(String createdBy);
    
    // Search textbooks by filename or content
    @Query("SELECT t FROM Textbook t WHERE " +
           "t.originalFilename LIKE %:searchTerm% OR " +
           "t.filename LIKE %:searchTerm% OR " +
           "t.subject LIKE %:searchTerm% OR " +
           "t.grade LIKE %:searchTerm%")
    List<Textbook> searchTextbooks(@Param("searchTerm") String searchTerm);
    
    // Get textbooks summary for dashboard
    @Query("SELECT " +
           "COUNT(t) as totalTextbooks, " +
           "COUNT(CASE WHEN t.status = 'processed' THEN 1 END) as processedTextbooks, " +
           "COUNT(CASE WHEN t.status = 'processing' THEN 1 END) as processingTextbooks, " +
           "COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failedTextbooks, " +
           "COALESCE(SUM(t.fileSize), 0) as totalFileSize " +
           "FROM Textbook t")
    Object[] getTextbookSummary();
    
    // Find recent textbooks
    @Query("SELECT t FROM Textbook t ORDER BY t.createdAt DESC")
    List<Textbook> findRecentTextbooks(Pageable pageable);
    
    // Check if textbook exists by grade and subject
    boolean existsByGradeAndSubjectAndOriginalFilename(String grade, String subject, String originalFilename);
    
    // Find textbooks by multiple statuses
    @Query("SELECT t FROM Textbook t WHERE t.status IN :statuses ORDER BY t.updatedAt DESC")
    List<Textbook> findByStatusIn(@Param("statuses") List<String> statuses);
}