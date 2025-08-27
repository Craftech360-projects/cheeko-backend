package xiaozhi.modules.textbook.repository;

import xiaozhi.modules.textbook.entity.RagUsageStats;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Repository
public interface RagUsageStatsRepository extends JpaRepository<RagUsageStats, Long> {
    
    // Find stats by date range
    List<RagUsageStats> findByQueryDateBetween(LocalDate startDate, LocalDate endDate);
    
    // Find stats by grade
    List<RagUsageStats> findByGrade(String grade);
    
    // Find stats by subject
    List<RagUsageStats> findBySubject(String subject);
    
    // Find stats by device
    List<RagUsageStats> findByDeviceId(String deviceId);
    
    // Count queries by date
    long countByQueryDate(LocalDate queryDate);
    
    // Count queries by grade
    long countByGrade(String grade);
    
    // Count queries by subject
    long countBySubject(String subject);
    
    // Get usage statistics with filtering
    @Query("SELECT r FROM RagUsageStats r WHERE " +
           "(:startDate IS NULL OR r.queryDate >= :startDate) AND " +
           "(:endDate IS NULL OR r.queryDate <= :endDate) AND " +
           "(:grade IS NULL OR r.grade = :grade) AND " +
           "(:subject IS NULL OR r.subject = :subject) " +
           "ORDER BY r.queryTimestamp DESC")
    List<RagUsageStats> getUsageStatistics(@Param("startDate") String startDate,
                                          @Param("endDate") String endDate,
                                          @Param("grade") String grade,
                                          @Param("subject") String subject);
    
    // Daily query counts
    @Query("SELECT r.queryDate, COUNT(r) FROM RagUsageStats r " +
           "WHERE r.queryDate BETWEEN :startDate AND :endDate " +
           "GROUP BY r.queryDate ORDER BY r.queryDate")
    List<Object[]> getDailyQueryCounts(@Param("startDate") LocalDate startDate,
                                       @Param("endDate") LocalDate endDate);
    
    // Grade distribution
    @Query("SELECT r.grade, COUNT(r) FROM RagUsageStats r " +
           "WHERE (:startDate IS NULL OR r.queryDate >= :startDate) AND " +
           "(:endDate IS NULL OR r.queryDate <= :endDate) " +
           "GROUP BY r.grade ORDER BY COUNT(r) DESC")
    List<Object[]> getGradeDistribution(@Param("startDate") LocalDate startDate,
                                        @Param("endDate") LocalDate endDate);
    
    // Subject distribution
    @Query("SELECT r.subject, COUNT(r) FROM RagUsageStats r " +
           "WHERE (:startDate IS NULL OR r.queryDate >= :startDate) AND " +
           "(:endDate IS NULL OR r.queryDate <= :endDate) " +
           "GROUP BY r.subject ORDER BY COUNT(r) DESC")
    List<Object[]> getSubjectDistribution(@Param("startDate") LocalDate startDate,
                                          @Param("endDate") LocalDate endDate);
    
    // Average response time by subject
    @Query("SELECT r.subject, AVG(r.responseTimeMs), COUNT(r) FROM RagUsageStats r " +
           "WHERE r.responseTimeMs IS NOT NULL " +
           "GROUP BY r.subject ORDER BY AVG(r.responseTimeMs)")
    List<Object[]> getAverageResponseTimeBySubject();
    
    // Average response time by grade
    @Query("SELECT r.grade, AVG(r.responseTimeMs), COUNT(r) FROM RagUsageStats r " +
           "WHERE r.responseTimeMs IS NOT NULL " +
           "GROUP BY r.grade ORDER BY r.grade")
    List<Object[]> getAverageResponseTimeByGrade();
    
    // Get accuracy ratings distribution
    @Query("SELECT r.accuracyRating, COUNT(r) FROM RagUsageStats r " +
           "WHERE r.accuracyRating IS NOT NULL " +
           "GROUP BY r.accuracyRating ORDER BY r.accuracyRating")
    List<Object[]> getAccuracyRatingDistribution();
    
    // Get average accuracy by subject
    @Query("SELECT r.subject, AVG(r.accuracyRating), COUNT(r) FROM RagUsageStats r " +
           "WHERE r.accuracyRating IS NOT NULL " +
           "GROUP BY r.subject ORDER BY AVG(r.accuracyRating) DESC")
    List<Object[]> getAverageAccuracyBySubject();
    
    // Find queries with poor accuracy (rating <= 2)
    @Query("SELECT r FROM RagUsageStats r WHERE r.accuracyRating IS NOT NULL AND r.accuracyRating <= 2 " +
           "ORDER BY r.queryTimestamp DESC")
    List<RagUsageStats> getPoorAccuracyQueries();
    
    // Find slow queries (response time > threshold)
    @Query("SELECT r FROM RagUsageStats r WHERE r.responseTimeMs > :thresholdMs " +
           "ORDER BY r.responseTimeMs DESC")
    List<RagUsageStats> getSlowQueries(@Param("thresholdMs") int thresholdMs);
    
    // Get hourly usage pattern
    @Query("SELECT HOUR(r.queryTimestamp) as hour, COUNT(r) as count FROM RagUsageStats r " +
           "WHERE r.queryDate = :queryDate " +
           "GROUP BY HOUR(r.queryTimestamp) ORDER BY hour")
    List<Object[]> getHourlyUsagePattern(@Param("queryDate") LocalDate queryDate);
    
    // Get most active devices
    @Query("SELECT r.deviceId, COUNT(r) FROM RagUsageStats r " +
           "WHERE r.deviceId IS NOT NULL " +
           "GROUP BY r.deviceId ORDER BY COUNT(r) DESC")
    List<Object[]> getMostActiveDevices();
    
    // Get performance summary
    @Query("SELECT " +
           "COUNT(r) as totalQueries, " +
           "AVG(r.responseTimeMs) as avgResponseTime, " +
           "MIN(r.responseTimeMs) as minResponseTime, " +
           "MAX(r.responseTimeMs) as maxResponseTime, " +
           "AVG(r.chunksRetrieved) as avgChunksRetrieved, " +
           "AVG(r.accuracyRating) as avgAccuracy " +
           "FROM RagUsageStats r WHERE " +
           "(:startDate IS NULL OR r.queryDate >= :startDate) AND " +
           "(:endDate IS NULL OR r.queryDate <= :endDate)")
    Object[] getPerformanceSummary(@Param("startDate") LocalDate startDate,
                                   @Param("endDate") LocalDate endDate);
    
    // Find duplicate questions (same hash)
    @Query("SELECT r.questionHash, COUNT(r) FROM RagUsageStats r " +
           "GROUP BY r.questionHash HAVING COUNT(r) > 1 " +
           "ORDER BY COUNT(r) DESC")
    List<Object[]> getFrequentQuestions();
    
    // Get language distribution
    @Query("SELECT r.language, COUNT(r) FROM RagUsageStats r " +
           "WHERE r.language IS NOT NULL " +
           "GROUP BY r.language ORDER BY COUNT(r) DESC")
    List<Object[]> getLanguageDistribution();
    
    // Get queries that retrieved zero chunks (no results found)
    @Query("SELECT r FROM RagUsageStats r WHERE r.chunksRetrieved = 0 OR r.chunksRetrieved IS NULL " +
           "ORDER BY r.queryTimestamp DESC")
    List<RagUsageStats> getNoResultQueries();
    
    // Get trending subjects (most queried recently)
    @Query("SELECT r.subject, COUNT(r) FROM RagUsageStats r " +
           "WHERE r.queryDate >= :sinceDate AND r.subject IS NOT NULL " +
           "GROUP BY r.subject ORDER BY COUNT(r) DESC")
    List<Object[]> getTrendingSubjects(@Param("sinceDate") LocalDate sinceDate);
    
    // Get user engagement (queries per device)
    @Query("SELECT AVG(device_queries.query_count) FROM " +
           "(SELECT COUNT(r) as query_count FROM RagUsageStats r " +
           "WHERE r.deviceId IS NOT NULL AND r.queryDate BETWEEN :startDate AND :endDate " +
           "GROUP BY r.deviceId) as device_queries")
    Double getAverageQueriesPerDevice(@Param("startDate") LocalDate startDate,
                                      @Param("endDate") LocalDate endDate);
    
    // Check if question hash exists (for duplicate detection)
    boolean existsByQuestionHash(String questionHash);
    
    // Find recent stats for a device
    List<RagUsageStats> findTop10ByDeviceIdOrderByQueryTimestampDesc(String deviceId);
}