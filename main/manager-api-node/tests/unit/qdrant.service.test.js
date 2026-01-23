/**
 * Qdrant Service Unit Tests
 *
 * Tests vector search operations with mocked Qdrant client.
 */

// Create mock functions before mocking the module
const mockGetCollections = jest.fn();
const mockGetCollection = jest.fn();
const mockCreateCollection = jest.fn();
const mockSearch = jest.fn();
const mockUpsert = jest.fn();
const mockDelete = jest.fn();
const mockRetrieve = jest.fn();

// Mock the @qdrant/js-client-rest module
jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    getCollections: mockGetCollections,
    getCollection: mockGetCollection,
    createCollection: mockCreateCollection,
    search: mockSearch,
    upsert: mockUpsert,
    delete: mockDelete,
    retrieve: mockRetrieve
  }))
}));

describe('Qdrant Service', () => {
  let qdrantService;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset modules to reload qdrant.service with fresh state
    jest.resetModules();

    // Set environment variables before importing
    process.env.QDRANT_URL = 'http://localhost:6333';
    process.env.QDRANT_API_KEY = 'test-api-key';
    process.env.QDRANT_COLLECTION = 'test_collection';
    process.env.QDRANT_VECTOR_SIZE = '1536';

    // Re-import the service with environment set
    qdrantService = require('../../src/services/integrations/qdrant.service');
  });

  afterEach(() => {
    // Clean up environment
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
    delete process.env.QDRANT_COLLECTION;
    delete process.env.QDRANT_VECTOR_SIZE;
  });

  describe('isAvailable', () => {
    it('should return true when QDRANT_URL is configured', () => {
      expect(qdrantService.isAvailable()).toBe(true);
    });

    it('should return false when QDRANT_URL is not configured', () => {
      jest.resetModules();
      delete process.env.QDRANT_URL;
      const freshService = require('../../src/services/integrations/qdrant.service');
      expect(freshService.isAvailable()).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });

      // Initialize client first
      qdrantService.getClient();

      const result = await qdrantService.testConnection();
      expect(result).toBe(true);
      expect(mockGetCollections).toHaveBeenCalled();
    });

    it('should return false when connection fails', async () => {
      mockGetCollections.mockRejectedValue(new Error('Connection refused'));

      // Initialize client first
      qdrantService.getClient();

      const result = await qdrantService.testConnection();
      expect(result).toBe(false);
    });

    it('should return false when client is not configured', async () => {
      jest.resetModules();
      delete process.env.QDRANT_URL;
      const freshService = require('../../src/services/integrations/qdrant.service');

      const result = await freshService.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('ensureCollection', () => {
    it('should return true if collection exists', async () => {
      mockGetCollections.mockResolvedValue({
        collections: [{ name: 'test_collection' }]
      });

      // Initialize client
      qdrantService.getClient();

      const result = await qdrantService.ensureCollection('test_collection');
      expect(result).toBe(true);
      expect(mockCreateCollection).not.toHaveBeenCalled();
    });

    it('should create collection if it does not exist', async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });
      mockCreateCollection.mockResolvedValue({});

      // Initialize client
      qdrantService.getClient();

      const result = await qdrantService.ensureCollection('new_collection', 768);
      expect(result).toBe(true);
      expect(mockCreateCollection).toHaveBeenCalledWith('new_collection', {
        vectors: {
          size: 768,
          distance: 'Cosine'
        }
      });
    });

    it('should throw error when client is not initialized', async () => {
      jest.resetModules();
      delete process.env.QDRANT_URL;
      const freshService = require('../../src/services/integrations/qdrant.service');

      await expect(freshService.ensureCollection())
        .rejects.toThrow('Qdrant client not initialized');
    });
  });

  describe('search', () => {
    const mockVector = new Array(1536).fill(0.1);

    beforeEach(() => {
      mockGetCollections.mockResolvedValue({
        collections: [{ name: 'test_collection' }]
      });
      // Initialize client
      qdrantService.getClient();
    });

    it('should return search results with scores and payloads', async () => {
      mockSearch.mockResolvedValue([
        { id: '1', score: 0.95, payload: { title: 'Result 1' } },
        { id: '2', score: 0.85, payload: { title: 'Result 2' } }
      ]);

      const results = await qdrantService.search({
        vector: mockVector,
        collection: 'test_collection',
        limit: 5
      });

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: '1',
        score: 0.95,
        payload: { title: 'Result 1' },
        vector: null
      });
      expect(results[1]).toEqual({
        id: '2',
        score: 0.85,
        payload: { title: 'Result 2' },
        vector: null
      });
    });

    it('should apply filter when provided', async () => {
      mockSearch.mockResolvedValue([]);

      const filter = {
        must: [{ key: 'category', match: { value: 'science' } }]
      };

      await qdrantService.search({
        vector: mockVector,
        filter
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ filter })
      );
    });

    it('should throw error when vector is missing', async () => {
      await expect(qdrantService.search({ vector: null }))
        .rejects.toThrow('Search vector is required');
    });

    it('should throw error when vector is empty', async () => {
      await expect(qdrantService.search({ vector: [] }))
        .rejects.toThrow('Search vector is required');
    });

    it('should throw error when client is not initialized', async () => {
      jest.resetModules();
      delete process.env.QDRANT_URL;
      const freshService = require('../../src/services/integrations/qdrant.service');

      await expect(freshService.search({ vector: mockVector }))
        .rejects.toThrow('Qdrant client not initialized');
    });
  });

  describe('searchByEmbedding', () => {
    it('should call search with embedding as vector', async () => {
      const mockEmbedding = new Array(1536).fill(0.2);

      mockSearch.mockResolvedValue([]);

      // Initialize client
      qdrantService.getClient();

      await qdrantService.searchByEmbedding({
        embedding: mockEmbedding,
        collection: 'test_collection'
      });

      expect(mockSearch).toHaveBeenCalledWith(
        'test_collection',
        expect.objectContaining({
          vector: mockEmbedding,
          with_payload: true
        })
      );
    });
  });

  describe('upsert', () => {
    const mockPoints = [
      { id: '1', vector: new Array(1536).fill(0.1), payload: { title: 'Point 1' } },
      { id: '2', vector: new Array(1536).fill(0.2), payload: { title: 'Point 2' } }
    ];

    beforeEach(() => {
      mockGetCollections.mockResolvedValue({
        collections: [{ name: 'test_collection' }]
      });
      // Initialize client
      qdrantService.getClient();
    });

    it('should upsert points successfully', async () => {
      mockUpsert.mockResolvedValue({ status: 'completed' });

      const result = await qdrantService.upsert({
        points: mockPoints,
        collection: 'test_collection'
      });

      expect(result).toEqual({
        success: true,
        status: 'completed',
        count: 2
      });

      expect(mockUpsert).toHaveBeenCalledWith('test_collection', {
        wait: true,
        points: mockPoints.map(p => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload
        }))
      });
    });

    it('should throw error when points array is empty', async () => {
      await expect(qdrantService.upsert({ points: [] }))
        .rejects.toThrow('Points array is required');
    });

    it('should throw error when points is null', async () => {
      await expect(qdrantService.upsert({ points: null }))
        .rejects.toThrow('Points array is required');
    });

    it('should throw error when point is missing id', async () => {
      await expect(qdrantService.upsert({
        points: [{ vector: new Array(1536).fill(0) }]
      })).rejects.toThrow('Each point must have an id');
    });

    it('should throw error when point is missing vector', async () => {
      await expect(qdrantService.upsert({
        points: [{ id: '1' }]
      })).rejects.toThrow('Each point must have a vector array');
    });
  });

  describe('upsertOne', () => {
    beforeEach(() => {
      mockGetCollections.mockResolvedValue({
        collections: [{ name: 'test_collection' }]
      });
      mockUpsert.mockResolvedValue({ status: 'completed' });
      // Initialize client
      qdrantService.getClient();
    });

    it('should upsert a single point', async () => {
      const result = await qdrantService.upsertOne({
        id: 'single-point',
        vector: new Array(1536).fill(0.5),
        payload: { content: 'test' }
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });
  });

  describe('deletePoints', () => {
    beforeEach(() => {
      // Initialize client
      qdrantService.getClient();
    });

    it('should delete points by IDs', async () => {
      mockDelete.mockResolvedValue({ status: 'completed' });

      const result = await qdrantService.deletePoints({
        ids: ['1', '2', '3'],
        collection: 'test_collection'
      });

      expect(result).toEqual({
        success: true,
        status: 'completed',
        count: 3
      });

      expect(mockDelete).toHaveBeenCalledWith('test_collection', {
        wait: true,
        points: ['1', '2', '3']
      });
    });

    it('should throw error when IDs array is empty', async () => {
      await expect(qdrantService.deletePoints({ ids: [] }))
        .rejects.toThrow('IDs array is required');
    });

    it('should throw error when IDs is null', async () => {
      await expect(qdrantService.deletePoints({ ids: null }))
        .rejects.toThrow('IDs array is required');
    });
  });

  describe('deleteByFilter', () => {
    beforeEach(() => {
      // Initialize client
      qdrantService.getClient();
    });

    it('should delete points by filter', async () => {
      mockDelete.mockResolvedValue({ status: 'completed' });

      const filter = {
        must: [{ key: 'category', match: { value: 'obsolete' } }]
      };

      const result = await qdrantService.deleteByFilter({
        filter,
        collection: 'test_collection'
      });

      expect(result.success).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('test_collection', {
        wait: true,
        filter
      });
    });

    it('should throw error when filter is missing', async () => {
      await expect(qdrantService.deleteByFilter({ filter: null }))
        .rejects.toThrow('Filter is required');
    });
  });

  describe('getPoint', () => {
    beforeEach(() => {
      // Initialize client
      qdrantService.getClient();
    });

    it('should retrieve a point by ID', async () => {
      mockRetrieve.mockResolvedValue([
        { id: 'test-id', payload: { title: 'Test' }, vector: null }
      ]);

      const result = await qdrantService.getPoint({
        id: 'test-id',
        collection: 'test_collection'
      });

      expect(result).toEqual({
        id: 'test-id',
        payload: { title: 'Test' },
        vector: null
      });
    });

    it('should return null when point is not found', async () => {
      mockRetrieve.mockResolvedValue([]);

      const result = await qdrantService.getPoint({
        id: 'nonexistent',
        collection: 'test_collection'
      });

      expect(result).toBeNull();
    });

    it('should return null for not found errors', async () => {
      mockRetrieve.mockRejectedValue(new Error('Point not found'));

      const result = await qdrantService.getPoint({
        id: 'nonexistent',
        collection: 'test_collection'
      });

      expect(result).toBeNull();
    });
  });

  describe('getCollectionInfo', () => {
    beforeEach(() => {
      // Initialize client
      qdrantService.getClient();
    });

    it('should return collection information', async () => {
      mockGetCollection.mockResolvedValue({
        points_count: 1000,
        vectors_count: 1000,
        status: 'green',
        config: { params: {} }
      });

      const result = await qdrantService.getCollectionInfo('test_collection');

      expect(result).toEqual({
        name: 'test_collection',
        pointsCount: 1000,
        vectorsCount: 1000,
        status: 'green',
        config: { params: {} }
      });
    });
  });

  describe('listCollections', () => {
    beforeEach(() => {
      // Initialize client
      qdrantService.getClient();
    });

    it('should return list of collection names', async () => {
      mockGetCollections.mockResolvedValue({
        collections: [
          { name: 'collection1' },
          { name: 'collection2' }
        ]
      });

      const result = await qdrantService.listCollections();

      expect(result).toEqual(['collection1', 'collection2']);
    });
  });

  describe('buildFilter', () => {
    it('should build filter with must conditions', () => {
      const filter = qdrantService.buildFilter({
        must: { category: 'science' }
      });

      expect(filter.must).toHaveLength(1);
      expect(filter.must[0]).toEqual({
        key: 'category',
        match: { value: 'science' }
      });
    });

    it('should build filter with range operators', () => {
      const filter = qdrantService.buildFilter({
        must: { age_min: { $lte: 8 } }
      });

      expect(filter.must).toHaveLength(1);
      expect(filter.must[0].key).toBe('age_min');
      expect(filter.must[0].range).toEqual({ lte: 8 });
    });

    it('should build filter with equality operator', () => {
      const filter = qdrantService.buildFilter({
        must: { level: { $eq: 5 } }
      });

      expect(filter.must).toHaveLength(1);
      expect(filter.must[0].key).toBe('level');
      expect(filter.must[0].match).toEqual({ value: 5 });
    });

    it('should build filter with should conditions (any match)', () => {
      const filter = qdrantService.buildFilter({
        should: { language: ['en', 'es', 'fr'] }
      });

      expect(filter.should).toHaveLength(1);
      expect(filter.should[0]).toEqual({
        key: 'language',
        match: { any: ['en', 'es', 'fr'] }
      });
    });

    it('should build filter with single should value', () => {
      const filter = qdrantService.buildFilter({
        should: { language: 'en' }
      });

      expect(filter.should).toHaveLength(1);
      expect(filter.should[0]).toEqual({
        key: 'language',
        match: { value: 'en' }
      });
    });

    it('should build filter with must_not conditions', () => {
      const filter = qdrantService.buildFilter({
        must_not: { status: 'archived' }
      });

      expect(filter.must_not).toHaveLength(1);
      expect(filter.must_not[0]).toEqual({
        key: 'status',
        match: { value: 'archived' }
      });
    });

    it('should build complex filter with multiple conditions', () => {
      const filter = qdrantService.buildFilter({
        must: {
          category: 'science',
          difficulty: { $lte: 3 }
        },
        should: {
          language: ['en', 'es']
        },
        must_not: {
          status: 'archived'
        }
      });

      expect(filter.must).toHaveLength(2);
      expect(filter.should).toHaveLength(1);
      expect(filter.must_not).toHaveLength(1);
    });

    it('should return empty filter when no conditions provided', () => {
      const filter = qdrantService.buildFilter({});
      expect(filter).toEqual({});
    });
  });

  describe('Constants', () => {
    it('should export DEFAULT_COLLECTION', () => {
      expect(qdrantService.DEFAULT_COLLECTION).toBe('test_collection');
    });

    it('should export DEFAULT_VECTOR_SIZE', () => {
      expect(qdrantService.DEFAULT_VECTOR_SIZE).toBe(1536);
    });
  });

  describe('getClient', () => {
    it('should return a client when configured', () => {
      const client = qdrantService.getClient();
      expect(client).toBeDefined();
    });

    it('should return null when not configured', () => {
      jest.resetModules();
      delete process.env.QDRANT_URL;
      const freshService = require('../../src/services/integrations/qdrant.service');

      const client = freshService.getClient();
      expect(client).toBeNull();
    });

    it('should return same client instance on multiple calls', () => {
      const client1 = qdrantService.getClient();
      const client2 = qdrantService.getClient();
      expect(client1).toBe(client2);
    });
  });
});
