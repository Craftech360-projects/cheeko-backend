package xiaozhi.modules.textbook.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "rag_usage_stats")
public class RagUsageStats {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "question_hash", nullable = false)
    private String questionHash;
    
    @Column(name = "grade")
    private String grade;
    
    @Column(name = "subject")
    private String subject;
    
    @Column(name = "language")
    private String language;
    
    @Column(name = "response_time_ms")
    private Integer responseTimeMs;
    
    @Column(name = "chunks_retrieved")
    private Integer chunksRetrieved;
    
    @Column(name = "accuracy_rating")
    private Integer accuracyRating;
    
    @Column(name = "query_date", nullable = false)
    private LocalDate queryDate;
    
    @Column(name = "query_timestamp")
    private LocalDateTime queryTimestamp;
    
    @Column(name = "device_id")
    private String deviceId;
    
    // Constructors
    public RagUsageStats() {
        this.queryDate = LocalDate.now();
        this.queryTimestamp = LocalDateTime.now();
    }
    
    public RagUsageStats(String questionHash, String grade, String subject) {
        this();
        this.questionHash = questionHash;
        this.grade = grade;
        this.subject = subject;
    }
    
    // Getters and Setters
    public Long getId() {
        return id;
    }
    
    public void setId(Long id) {
        this.id = id;
    }
    
    public String getQuestionHash() {
        return questionHash;
    }
    
    public void setQuestionHash(String questionHash) {
        this.questionHash = questionHash;
    }
    
    public String getGrade() {
        return grade;
    }
    
    public void setGrade(String grade) {
        this.grade = grade;
    }
    
    public String getSubject() {
        return subject;
    }
    
    public void setSubject(String subject) {
        this.subject = subject;
    }
    
    public String getLanguage() {
        return language;
    }
    
    public void setLanguage(String language) {
        this.language = language;
    }
    
    public Integer getResponseTimeMs() {
        return responseTimeMs;
    }
    
    public void setResponseTimeMs(Integer responseTimeMs) {
        this.responseTimeMs = responseTimeMs;
    }
    
    public Integer getChunksRetrieved() {
        return chunksRetrieved;
    }
    
    public void setChunksRetrieved(Integer chunksRetrieved) {
        this.chunksRetrieved = chunksRetrieved;
    }
    
    public Integer getAccuracyRating() {
        return accuracyRating;
    }
    
    public void setAccuracyRating(Integer accuracyRating) {
        this.accuracyRating = accuracyRating;
    }
    
    public LocalDate getQueryDate() {
        return queryDate;
    }
    
    public void setQueryDate(LocalDate queryDate) {
        this.queryDate = queryDate;
    }
    
    public LocalDateTime getQueryTimestamp() {
        return queryTimestamp;
    }
    
    public void setQueryTimestamp(LocalDateTime queryTimestamp) {
        this.queryTimestamp = queryTimestamp;
    }
    
    public String getDeviceId() {
        return deviceId;
    }
    
    public void setDeviceId(String deviceId) {
        this.deviceId = deviceId;
    }
    
    // Helper methods
    public boolean hasAccuracyRating() {
        return accuracyRating != null && accuracyRating > 0;
    }
    
    public boolean isGoodRating() {
        return accuracyRating != null && accuracyRating >= 4;
    }
    
    public double getResponseTimeSeconds() {
        return responseTimeMs != null ? responseTimeMs / 1000.0 : 0.0;
    }
    
    @Override
    public String toString() {
        return "RagUsageStats{" +
                "id=" + id +
                ", grade='" + grade + '\'' +
                ", subject='" + subject + '\'' +
                ", responseTimeMs=" + responseTimeMs +
                ", chunksRetrieved=" + chunksRetrieved +
                ", queryDate=" + queryDate +
                '}';
    }
}