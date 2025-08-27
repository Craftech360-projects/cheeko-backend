package xiaozhi.modules.textbook.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "textbooks")
public class Textbook {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "filename", nullable = false)
    private String filename;
    
    @Column(name = "original_filename", nullable = false)
    private String originalFilename;
    
    @Column(name = "grade")
    private String grade;
    
    @Column(name = "subject")
    private String subject;
    
    @Column(name = "language")
    private String language = "en";
    
    @Column(name = "upload_date")
    private LocalDateTime uploadDate;
    
    @Column(name = "file_size")
    private Long fileSize;
    
    @Column(name = "status")
    private String status = "uploaded";
    
    @Column(name = "processed_chunks")
    private Integer processedChunks = 0;
    
    @Column(name = "total_pages")
    private Integer totalPages;
    
    @Column(name = "qdrant_collection")
    private String qdrantCollection;
    
    @Column(name = "created_by")
    private String createdBy;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
    
    // Constructors
    public Textbook() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        this.uploadDate = LocalDateTime.now();
    }
    
    public Textbook(String filename, String originalFilename, String grade, String subject) {
        this();
        this.filename = filename;
        this.originalFilename = originalFilename;
        this.grade = grade;
        this.subject = subject;
    }
    
    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
    
    // Getters and Setters
    public Long getId() {
        return id;
    }
    
    public void setId(Long id) {
        this.id = id;
    }
    
    public String getFilename() {
        return filename;
    }
    
    public void setFilename(String filename) {
        this.filename = filename;
    }
    
    public String getOriginalFilename() {
        return originalFilename;
    }
    
    public void setOriginalFilename(String originalFilename) {
        this.originalFilename = originalFilename;
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
    
    public LocalDateTime getUploadDate() {
        return uploadDate;
    }
    
    public void setUploadDate(LocalDateTime uploadDate) {
        this.uploadDate = uploadDate;
    }
    
    public Long getFileSize() {
        return fileSize;
    }
    
    public void setFileSize(Long fileSize) {
        this.fileSize = fileSize;
    }
    
    public String getStatus() {
        return status;
    }
    
    public void setStatus(String status) {
        this.status = status;
    }
    
    public Integer getProcessedChunks() {
        return processedChunks;
    }
    
    public void setProcessedChunks(Integer processedChunks) {
        this.processedChunks = processedChunks;
    }
    
    public Integer getTotalPages() {
        return totalPages;
    }
    
    public void setTotalPages(Integer totalPages) {
        this.totalPages = totalPages;
    }
    
    public String getQdrantCollection() {
        return qdrantCollection;
    }
    
    public void setQdrantCollection(String qdrantCollection) {
        this.qdrantCollection = qdrantCollection;
    }
    
    public String getCreatedBy() {
        return createdBy;
    }
    
    public void setCreatedBy(String createdBy) {
        this.createdBy = createdBy;
    }
    
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
    
    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
    
    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
    
    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
    
    // Helper methods
    public boolean isProcessed() {
        return "processed".equals(this.status);
    }
    
    public boolean isProcessing() {
        return "processing".equals(this.status);
    }
    
    public boolean isFailed() {
        return "failed".equals(this.status);
    }
    
    public String getDisplayName() {
        return originalFilename != null ? originalFilename : filename;
    }
    
    @Override
    public String toString() {
        return "Textbook{" +
                "id=" + id +
                ", filename='" + filename + '\'' +
                ", originalFilename='" + originalFilename + '\'' +
                ", grade='" + grade + '\'' +
                ", subject='" + subject + '\'' +
                ", status='" + status + '\'' +
                '}';
    }
}