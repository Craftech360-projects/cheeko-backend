# Textbook RAG Implementation - Step-by-Step Task List

## 📋 Complete Implementation Checklist

### **Prerequisites (Day 0)**
- [ ] ✅ Verify existing xiaozhi-server is running properly
- [ ] ✅ Confirm manager-api and manager-web are operational
- [ ] ✅ Test function calling is working (check existing functions like `get_weather`)
- [ ] ✅ Ensure Redis is running for caching
- [ ] ✅ Have access to server deployment environment

---

## **PHASE 1: External Services Setup (Day 1)**

### **1.1 Qdrant Cloud Setup** ⏱️ 30 minutes
- [ ] Create account at [Qdrant Cloud](https://cloud.qdrant.io/)
- [ ] Create new cluster (use free tier: 1GB, 100k vectors)
- [ ] Note cluster URL: `https://your-cluster-xyz.qdrant.tech`
- [ ] Generate and save API key
- [ ] Test connection with simple HTTP request

### **1.2 Voyage AI Setup** ⏱️ 15 minutes  
- [ ] Create account at [Voyage AI](https://www.voyageai.com/)
- [ ] Generate API key
- [ ] Test embeddings API with sample text
- [ ] Verify `voyage-3-lite` model access

### **1.3 Environment Configuration** ⏱️ 15 minutes
- [ ] Create/update `.env` file with API keys:
  ```bash
  QDRANT_URL=https://your-cluster-xyz.qdrant.tech
  QDRANT_API_KEY=your-qdrant-api-key
  VOYAGE_API_KEY=your-voyage-api-key
  ```
- [ ] Add environment variables to deployment system

---

## **PHASE 2: Database & Backend Setup (Day 1-2)**

### **2.1 Database Schema Updates** ⏱️ 45 minutes
- [ ] Create `schema-updates.sql` file with textbook tables
- [ ] Run SQL updates on your database:
  ```sql
  -- textbooks table
  -- textbook_chunks table  
  -- rag_usage_stats table
  -- indexes
  ```
- [ ] Verify tables created successfully
- [ ] Test basic CRUD operations

### **2.2 Manager-API Backend** ⏱️ 4 hours
- [ ] Create `TextbookController.java`
  - [ ] Upload endpoint (`POST /api/textbooks/upload`)
  - [ ] List textbooks (`GET /api/textbooks`)
  - [ ] Process endpoint (`POST /api/textbooks/{id}/process`)
  - [ ] Delete endpoint (`DELETE /api/textbooks/{id}`)
  - [ ] Stats endpoint (`GET /api/textbooks/stats/overview`)
  - [ ] Search endpoint (`GET /api/textbooks/search`)

- [ ] Create `TextbookService.java`
  - [ ] File upload handling
  - [ ] Metadata extraction
  - [ ] Database operations
  - [ ] Statistics generation

- [ ] Create entity classes
  - [ ] `Textbook.java`
  - [ ] `TextbookChunk.java`
  - [ ] `RagUsageStats.java`

- [ ] Create repository interfaces
  - [ ] `TextbookRepository.java`
  - [ ] `TextbookChunkRepository.java`
  - [ ] `RagUsageStatsRepository.java`

- [ ] Test all API endpoints with Postman/curl

### **2.3 Textbook Processing Service** ⏱️ 3 hours
- [ ] Create `TextbookProcessorService.java`
- [ ] Implement PDF text extraction (Apache PDFBox)
- [ ] Add text chunking logic (1000 chars, 200 overlap)
- [ ] Create Voyage API integration for embeddings
- [ ] Add Qdrant upload functionality
- [ ] Implement async processing with progress tracking
- [ ] Test with sample PDF file

---

## **PHASE 3: Core RAG Function (Day 2)**

### **3.1 Textbook Assistant Function** ⏱️ 3 hours
- [ ] Create `plugins_func/functions/textbook_assistant.py`
- [ ] Implement function structure with proper registration
- [ ] Add embedding generation for queries
- [ ] Create Qdrant search functionality
- [ ] Implement response formatting for different grades
- [ ] Add caching integration
- [ ] Test function independently

### **3.2 Configuration Updates** ⏱️ 30 minutes
- [ ] Update `config.yaml`:
  ```yaml
  Intent:
    function_call:
      functions:
        - textbook_assistant  # Add this line
  
  plugins:
    textbook_assistant:
      # Add full configuration
  ```
- [ ] Test configuration loading
- [ ] Verify function is registered properly

### **3.3 Integration Testing** ⏱️ 1 hour
- [ ] Test textbook_assistant function via websocket
- [ ] Verify error handling for missing config
- [ ] Test with different grade levels
- [ ] Check caching is working
- [ ] Test edge cases (empty results, API failures)

---

## **PHASE 4: Management Dashboard (Day 2-3)**

### **4.1 Frontend Components** ⏱️ 5 hours
- [ ] Create `main/manager-web/src/components/TextbookManagement.vue`
- [ ] Implement upload interface (drag & drop)
- [ ] Add textbook listing table with filters
- [ ] Create statistics dashboard
- [ ] Add bulk operations UI
- [ ] Implement textbook details view
- [ ] Add RAG search testing interface

### **4.2 Navigation Integration** ⏱️ 30 minutes
- [ ] Update `router/index.js` with textbook route
- [ ] Add menu item to `HeaderBar.vue`
- [ ] Test navigation works properly

### **4.3 API Integration** ⏱️ 2 hours
- [ ] Connect frontend to backend APIs
- [ ] Implement file upload with progress
- [ ] Add error handling and notifications
- [ ] Test all CRUD operations from UI
- [ ] Verify real-time status updates

---

## **PHASE 5: Content Processing & Upload (Day 3)**

### **5.1 Qdrant Collection Setup** ⏱️ 30 minutes
- [ ] Create `scripts/setup_qdrant_collection.py`
- [ ] Run script to create collection with proper schema
- [ ] Verify collection exists and has correct configuration
- [ ] Test basic vector operations

### **5.2 Textbook Processing Scripts** ⏱️ 2 hours
- [ ] Create `scripts/process_textbooks.py`
- [ ] Implement batch PDF processing
- [ ] Add progress tracking and logging  
- [ ] Test with sample NCERT PDFs
- [ ] Verify embeddings and upload to Qdrant

### **5.3 Sample Content** ⏱️ 1 hour
- [ ] Download sample NCERT textbooks (2-3 PDFs)
- [ ] Process through upload pipeline
- [ ] Verify content appears in dashboard
- [ ] Test search functionality with real content

---

## **PHASE 6: Testing & Optimization (Day 4)**

### **6.1 End-to-End Testing** ⏱️ 3 hours
- [ ] Test complete student query flow:
  - Kid asks: "What is photosynthesis?"
  - System retrieves relevant content
  - Generates age-appropriate response
- [ ] Test different subjects and grade levels
- [ ] Verify caching is working
- [ ] Test error scenarios and fallbacks
- [ ] Performance testing with multiple concurrent queries

### **6.2 Dashboard Testing** ⏱️ 2 hours
- [ ] Test file upload with different PDF sizes
- [ ] Verify metadata extraction
- [ ] Test bulk operations
- [ ] Check statistics accuracy
- [ ] Test RAG search interface
- [ ] Verify all CRUD operations

### **6.3 Performance Optimization** ⏱️ 2 hours
- [ ] Monitor API response times
- [ ] Optimize database queries
- [ ] Fine-tune caching parameters
- [ ] Test with larger textbook collections
- [ ] Verify memory usage is reasonable

---

## **PHASE 7: Production Deployment (Day 4-5)**

### **7.1 Security & Configuration** ⏱️ 1 hour
- [ ] Move API keys to secure environment variables
- [ ] Set up rate limiting for API endpoints
- [ ] Configure proper CORS for web interface
- [ ] Set up logging and monitoring
- [ ] Verify data backup strategy

### **7.2 Deployment** ⏱️ 2 hours
- [ ] Deploy updated manager-api
- [ ] Deploy updated manager-web
- [ ] Deploy updated xiaozhi-server with new function
- [ ] Run database migrations
- [ ] Test all systems are communicating

### **7.3 Production Verification** ⏱️ 1 hour
- [ ] Test with real AI toy device
- [ ] Verify end-to-end student interaction
- [ ] Check dashboard accessibility
- [ ] Monitor system resource usage
- [ ] Verify all logging is working

---

## **PHASE 8: Documentation & Training (Day 5)**

### **8.1 User Documentation** ⏱️ 2 hours
- [ ] Create admin guide for uploading textbooks
- [ ] Document dashboard features
- [ ] Write troubleshooting guide
- [ ] Create video tutorial for non-technical users

### **8.2 Technical Documentation** ⏱️ 1 hour
- [ ] Document API endpoints
- [ ] Update system architecture docs
- [ ] Document configuration options
- [ ] Create maintenance procedures

---

## **🚀 STAGE 4: Reranker Enhancement (Optional - Week 2)**

### **4.1 Reranker Integration** ⏱️ 4 hours
- [ ] Update `textbook_assistant.py` with two-stage retrieval
- [ ] Add Voyage reranker API integration
- [ ] Implement fallback strategy
- [ ] Add A/B testing configuration
- [ ] Test performance impact

### **4.2 Dashboard Enhancements** ⏱️ 2 hours
- [ ] Add reranker metrics to dashboard
- [ ] Create A/B testing toggle
- [ ] Add cost monitoring for reranker usage
- [ ] Update statistics displays

### **4.3 Performance Testing** ⏱️ 2 hours
- [ ] Compare accuracy with/without reranker
- [ ] Measure response time impact
- [ ] Test with various query types
- [ ] Optimize caching for reranked results

---

## **Daily Breakdown Summary**

### **Day 1: Foundation** 
- ✅ External services setup (Qdrant, Voyage AI)
- ✅ Database schema and basic backend APIs
- ✅ Environment configuration

### **Day 2: Core Implementation**
- ✅ Complete manager-api backend
- ✅ RAG function implementation  
- ✅ Basic dashboard components

### **Day 3: Content & UI**
- ✅ Content processing pipeline
- ✅ Dashboard completion
- ✅ Sample textbook upload

### **Day 4: Testing & Optimization**
- ✅ End-to-end testing
- ✅ Performance optimization
- ✅ Production deployment

### **Day 5: Documentation & Polish**
- ✅ User/technical documentation
- ✅ Final testing and refinement

---

## **Success Criteria Checklist**

- [ ] **Functional**: Students can ask academic questions and get relevant answers
- [ ] **User-Friendly**: Non-technical admins can upload textbooks via dashboard
- [ ] **Performant**: Responses under 1 second, dashboard loads quickly
- [ ] **Reliable**: System handles errors gracefully, has proper fallbacks
- [ ] **Scalable**: Can handle 100+ concurrent student queries
- [ ] **Cost-Effective**: Monthly costs under budget (~$50/month for 1000 students)
- [ ] **Maintainable**: Admins can manage content without technical help

---

## **Dependencies & Blockers**

### **Critical Dependencies:**
1. **NCERT PDF textbooks** - Need sample content for testing
2. **Qdrant Cloud access** - Required for vector storage
3. **Voyage AI API access** - Required for embeddings
4. **Java development environment** - For manager-api changes

### **Potential Blockers:**
1. **PDF extraction quality** - Some textbooks may have complex layouts
2. **API rate limits** - Voyage AI free tier limits
3. **Database permissions** - Need schema modification access
4. **Deployment access** - Need ability to update production systems

---

## **Rollback Plan**

If implementation fails at any stage:

1. **Phase 1-2 failure**: No impact on existing system
2. **Phase 3 failure**: Remove textbook_assistant from config.yaml
3. **Phase 4 failure**: Dashboard is separate, won't affect core system
4. **Production issues**: Keep backup of pre-modification database and code

---

## **Post-Implementation Tasks**

### **Week 1: Monitoring**
- [ ] Monitor student usage patterns
- [ ] Track response accuracy feedback
- [ ] Monitor API costs and usage
- [ ] Collect admin feedback on dashboard

### **Week 2-4: Optimization**
- [ ] Fine-tune similarity thresholds based on real usage
- [ ] Add more textbook content based on popular subjects
- [ ] Optimize frequently-asked questions
- [ ] Consider Stage 4 reranker enhancement

**Total Estimated Time: 4-5 days for core implementation + 2-3 days for reranker enhancement**