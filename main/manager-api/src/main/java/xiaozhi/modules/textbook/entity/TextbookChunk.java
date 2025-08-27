package xiaozhi.modules.textbook.entity;

import jakarta.persistence.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.LocalDateTime;

@Entity
@Table(name = "textbook_chunks")
public class TextbookChunk {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "textbook_id", nullable = false)
    private Long textbookId;
    
    @Column(name = "chunk_index", nullable = false)
    private Integer chunkIndex;
    
    @Column(name = "content", nullable = false, columnDefinition = "TEXT")
    private String content;
    
    @Column(name = "page_number")
    private Integer pageNumber;
    
    @Column(name = "chapter_title")
    private String chapterTitle;
    
    @Column(name = "qdrant_point_id")
    private String qdrantPointId;
    
    @Column(name = "embedding_status")
    private String embeddingStatus = "pending";
    
    @Column(name = "embedding_vector", columnDefinition = "TEXT")
    private String embeddingVector; // JSON string of the embedding vector
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "textbook_id", insertable = false, updatable = false)
    private Textbook textbook;
    
    // Constructors
    public TextbookChunk() {
        this.createdAt = LocalDateTime.now();
    }
    
    public TextbookChunk(Long textbookId, Integer chunkIndex, String content) {
        this();
        this.textbookId = textbookId;
        this.chunkIndex = chunkIndex;
        this.content = content;
    }
    
    // Getters and Setters
    public Long getId() {
        return id;
    }
    
    public void setId(Long id) {
        this.id = id;
    }
    
    public Long getTextbookId() {
        return textbookId;
    }
    
    public void setTextbookId(Long textbookId) {
        this.textbookId = textbookId;
    }
    
    public Integer getChunkIndex() {
        return chunkIndex;
    }
    
    public void setChunkIndex(Integer chunkIndex) {
        this.chunkIndex = chunkIndex;
    }
    
    public String getContent() {
        return content;
    }
    
    public void setContent(String content) {
        this.content = content;
    }
    
    public Integer getPageNumber() {
        return pageNumber;
    }
    
    public void setPageNumber(Integer pageNumber) {
        this.pageNumber = pageNumber;
    }
    
    public String getChapterTitle() {
        return chapterTitle;
    }
    
    public void setChapterTitle(String chapterTitle) {
        this.chapterTitle = chapterTitle;
    }
    
    public String getQdrantPointId() {
        return qdrantPointId;
    }
    
    public void setQdrantPointId(String qdrantPointId) {
        this.qdrantPointId = qdrantPointId;
    }
    
    public String getEmbeddingStatus() {
        return embeddingStatus;
    }
    
    public void setEmbeddingStatus(String embeddingStatus) {
        this.embeddingStatus = embeddingStatus;
    }
    
    public String getEmbeddingVector() {
        return embeddingVector;
    }
    
    public void setEmbeddingVector(String embeddingVector) {
        this.embeddingVector = embeddingVector;
    }
    
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
    
    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
    
    public Textbook getTextbook() {
        return textbook;
    }
    
    public void setTextbook(Textbook textbook) {
        this.textbook = textbook;
    }
    
    // Helper methods
    public boolean isEmbeddingGenerated() {
        return "generated".equals(this.embeddingStatus);
    }
    
    public boolean isUploaded() {
        return "uploaded".equals(this.embeddingStatus);
    }
    
    public boolean isFailed() {
        return "failed".equals(this.embeddingStatus);
    }
    
    public String getContentPreview() {
        return content != null && content.length() > 100 
            ? content.substring(0, 100) + "..." 
            : content;
    }
    
    @Override
    public String toString() {
        return "TextbookChunk{" +
                "id=" + id +
                ", textbookId=" + textbookId +
                ", chunkIndex=" + chunkIndex +
                ", pageNumber=" + pageNumber +
                ", embeddingStatus='" + embeddingStatus + '\'' +
                '}';
    }
}