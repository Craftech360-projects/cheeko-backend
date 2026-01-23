/**
 * Mem0 Service Unit Tests
 *
 * Tests memory operations with mocked HTTP requests.
 */

// Mock fetch before requiring the service
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Mem0 Service', () => {
  let mem0Service;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    mockFetch.mockReset();

    // Reset modules to reload mem0.service with fresh state
    jest.resetModules();

    // Set environment variables before importing
    process.env.MEM0_API_KEY = 'test-api-key';
    process.env.MEM0_API_URL = 'https://api.mem0.ai/v1';
    process.env.MEM0_MEMORY_LIMIT = '20';
    process.env.MEM0_TIMEOUT_MS = '5000';

    // Re-import the service with environment set
    mem0Service = require('../../src/services/integrations/mem0.service');
  });

  afterEach(() => {
    // Clean up environment
    delete process.env.MEM0_API_KEY;
    delete process.env.MEM0_API_URL;
    delete process.env.MEM0_MEMORY_LIMIT;
    delete process.env.MEM0_TIMEOUT_MS;
  });

  describe('isAvailable', () => {
    it('should return true when MEM0_API_KEY is configured', () => {
      expect(mem0Service.isAvailable()).toBe(true);
    });

    it('should return false when MEM0_API_KEY is not configured', () => {
      jest.resetModules();
      delete process.env.MEM0_API_KEY;
      const freshService = require('../../src/services/integrations/mem0.service');
      expect(freshService.isAvailable()).toBe(false);
    });
  });

  describe('normalizeUserId', () => {
    it('should lowercase the user ID', () => {
      expect(mem0Service.normalizeUserId('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff');
    });

    it('should preserve colons and dashes', () => {
      expect(mem0Service.normalizeUserId('AA-BB-CC-DD-EE-FF')).toBe('aa-bb-cc-dd-ee-ff');
    });

    it('should return empty string for null/undefined', () => {
      expect(mem0Service.normalizeUserId(null)).toBe('');
      expect(mem0Service.normalizeUserId(undefined)).toBe('');
    });
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([])
      });

      // Initialize client first
      mem0Service.getClient();

      const result = await mem0Service.testConnection();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return false when connection fails', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      // Initialize client first
      mem0Service.getClient();

      const result = await mem0Service.testConnection();
      expect(result).toBe(false);
    });

    it('should return false when client is not configured', async () => {
      jest.resetModules();
      delete process.env.MEM0_API_KEY;
      const freshService = require('../../src/services/integrations/mem0.service');

      const result = await freshService.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('searchMemories', () => {
    beforeEach(() => {
      // Initialize client
      mem0Service.getClient();
    });

    it('should return memories with relations and entities', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          results: [
            {
              memory: 'Loves dinosaurs',
              entities: [{ id: '1', name: 'dinosaurs', type: 'interest' }]
            },
            {
              memory: 'Has a dog named Max',
              entities: [{ id: '2', name: 'Max', type: 'pet' }]
            }
          ],
          relations: [
            { source: 'user', relation: 'has_pet', target: 'Max' }
          ]
        })
      });

      const result = await mem0Service.searchMemories({
        userId: 'AA:BB:CC:DD:EE:FF'
      });

      expect(result.memories).toHaveLength(2);
      expect(result.memories[0]).toBe('Loves dinosaurs');
      expect(result.entities).toHaveLength(2);
      expect(result.relations).toHaveLength(1);
    });

    it('should handle array response format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { memory: 'Fact 1', entities: [] },
          { memory: 'Fact 2', entities: [] }
        ])
      });

      const result = await mem0Service.searchMemories({
        userId: 'test-user'
      });

      expect(result.memories).toHaveLength(2);
      expect(result.memories).toContain('Fact 1');
    });

    it('should throw error when user ID is missing', async () => {
      await expect(mem0Service.searchMemories({ userId: null }))
        .rejects.toThrow('User ID is required');
    });

    it('should return empty results when client is not configured', async () => {
      jest.resetModules();
      delete process.env.MEM0_API_KEY;
      const freshService = require('../../src/services/integrations/mem0.service');

      const result = await freshService.searchMemories({ userId: 'test' });
      expect(result).toEqual({ memories: [], relations: [], entities: [] });
    });

    it('should return empty results on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Server error' })
      });

      const result = await mem0Service.searchMemories({ userId: 'test' });
      expect(result).toEqual({ memories: [], relations: [], entities: [] });
    });

    it('should pass custom query and limit', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [], relations: [] })
      });

      await mem0Service.searchMemories({
        userId: 'test',
        query: 'What are the hobbies?',
        limit: 10
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.query).toBe('What are the hobbies?');
      expect(callArgs.limit).toBe(10);
    });
  });

  describe('getAllMemories', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should return all memories for a user', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { memory: 'Memory 1' },
          { memory: 'Memory 2' }
        ])
      });

      const result = await mem0Service.getAllMemories({ userId: 'test-user' });

      expect(result.memories).toHaveLength(2);
      expect(result.memories).toContain('Memory 1');
    });

    it('should throw error when user ID is missing', async () => {
      await expect(mem0Service.getAllMemories({ userId: null }))
        .rejects.toThrow('User ID is required');
    });
  });

  describe('addMemory', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should add messages to memory', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      const result = await mem0Service.addMemory({
        userId: 'test-user',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' }
        ]
      });

      expect(result).toEqual({ success: true });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.user_id).toBe('test-user');
      expect(callArgs.enable_graph).toBe(true);
    });

    it('should include metadata when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await mem0Service.addMemory({
        userId: 'test-user',
        messages: [{ role: 'user', content: 'Test' }],
        metadata: { session_id: 'sess123' }
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.metadata).toEqual({ session_id: 'sess123' });
    });

    it('should throw error when user ID is missing', async () => {
      await expect(mem0Service.addMemory({
        userId: null,
        messages: [{ role: 'user', content: 'Test' }]
      })).rejects.toThrow('User ID is required');
    });

    it('should throw error when messages is empty', async () => {
      await expect(mem0Service.addMemory({
        userId: 'test',
        messages: []
      })).rejects.toThrow('Messages array is required');
    });

    it('should filter out invalid messages', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await mem0Service.addMemory({
        userId: 'test-user',
        messages: [
          { role: 'user', content: 'Valid message' },
          { role: 'invalid', content: 'Invalid role' },
          { role: 'user', content: '' },
          { role: 'assistant', content: 'Another valid' }
        ]
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.messages).toHaveLength(2);
    });

    it('should return null when all messages are invalid', async () => {
      const result = await mem0Service.addMemory({
        userId: 'test-user',
        messages: [
          { role: 'invalid', content: 'Bad' },
          { role: 'user', content: '' }
        ]
      });

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null when client is not configured', async () => {
      jest.resetModules();
      delete process.env.MEM0_API_KEY;
      const freshService = require('../../src/services/integrations/mem0.service');

      const result = await freshService.addMemory({
        userId: 'test',
        messages: [{ role: 'user', content: 'Test' }]
      });
      expect(result).toBeNull();
    });
  });

  describe('addFact', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should add a single fact', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      const result = await mem0Service.addFact({
        userId: 'test-user',
        fact: 'Loves ice cream'
      });

      expect(result).toEqual({ success: true });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].content).toBe('Loves ice cream');
    });

    it('should return null for empty fact', async () => {
      const result = await mem0Service.addFact({
        userId: 'test-user',
        fact: ''
      });

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('addConversation', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should convert chat history format to messages', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await mem0Service.addConversation({
        userId: 'test-user',
        chatHistory: [
          { chatType: 1, content: 'Hello' },
          { chatType: 2, content: 'Hi there!' },
          { chatType: 1, content: 'How are you?' }
        ],
        sessionId: 'sess123'
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.messages).toHaveLength(3);
      expect(callArgs.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(callArgs.messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
      expect(callArgs.metadata).toEqual({ session_id: 'sess123' });
    });

    it('should filter out empty messages', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await mem0Service.addConversation({
        userId: 'test-user',
        chatHistory: [
          { chatType: 1, content: 'Valid' },
          { chatType: 2, content: '  ' },
          { chatType: 1, content: '' }
        ]
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.messages).toHaveLength(1);
    });

    it('should return null for empty chat history', async () => {
      const result = await mem0Service.addConversation({
        userId: 'test-user',
        chatHistory: []
      });

      expect(result).toBeNull();
    });
  });

  describe('deleteMemory', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should delete a specific memory', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({})
      });

      const result = await mem0Service.deleteMemory({ memoryId: 'mem123' });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/memories/mem123/'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should throw error when memory ID is missing', async () => {
      await expect(mem0Service.deleteMemory({ memoryId: null }))
        .rejects.toThrow('Memory ID is required');
    });

    it('should return false on error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'Not found' })
      });

      const result = await mem0Service.deleteMemory({ memoryId: 'nonexistent' });
      expect(result).toBe(false);
    });
  });

  describe('deleteAllMemories', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should delete all memories for a user', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({})
      });

      const result = await mem0Service.deleteAllMemories({ userId: 'test-user' });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/memories/'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should throw error when user ID is missing', async () => {
      await expect(mem0Service.deleteAllMemories({ userId: null }))
        .rejects.toThrow('User ID is required');
    });
  });

  describe('getMemory', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should get a memory by ID', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'mem123', memory: 'Test memory' })
      });

      const result = await mem0Service.getMemory({ memoryId: 'mem123' });

      expect(result).toEqual({ id: 'mem123', memory: 'Test memory' });
    });

    it('should return null for not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: '404 not found' })
      });

      const result = await mem0Service.getMemory({ memoryId: 'nonexistent' });
      expect(result).toBeNull();
    });

    it('should throw error when memory ID is missing', async () => {
      await expect(mem0Service.getMemory({ memoryId: null }))
        .rejects.toThrow('Memory ID is required');
    });
  });

  describe('updateMemory', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should update a memory', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'mem123', memory: 'Updated text' })
      });

      const result = await mem0Service.updateMemory({
        memoryId: 'mem123',
        text: 'Updated text'
      });

      expect(result).toEqual({ id: 'mem123', memory: 'Updated text' });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.text).toBe('Updated text');
    });

    it('should throw error when memory ID is missing', async () => {
      await expect(mem0Service.updateMemory({ memoryId: null, text: 'Test' }))
        .rejects.toThrow('Memory ID is required');
    });

    it('should throw error when text is missing', async () => {
      await expect(mem0Service.updateMemory({ memoryId: 'mem123', text: '' }))
        .rejects.toThrow('Text is required');
    });
  });

  describe('getMemoryHistory', () => {
    beforeEach(() => {
      mem0Service.getClient();
    });

    it('should get memory history', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { id: 'v1', memory: 'Version 1' },
          { id: 'v2', memory: 'Version 2' }
        ])
      });

      const result = await mem0Service.getMemoryHistory({ memoryId: 'mem123' });

      expect(result).toHaveLength(2);
    });

    it('should throw error when memory ID is missing', async () => {
      await expect(mem0Service.getMemoryHistory({ memoryId: null }))
        .rejects.toThrow('Memory ID is required');
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Error',
        json: () => Promise.resolve({})
      });

      const result = await mem0Service.getMemoryHistory({ memoryId: 'mem123' });
      expect(result).toEqual([]);
    });
  });

  describe('formatForPrompt', () => {
    it('should format memories for prompt injection', () => {
      const memoryData = {
        memories: ['Loves dinosaurs', 'Has a dog named Max'],
        relations: [
          { source: 'user', relation: 'has_pet', target: 'Max' }
        ],
        entities: []
      };

      const result = mem0Service.formatForPrompt(memoryData);

      expect(result).toContain('## What I know about you:');
      expect(result).toContain('- Loves dinosaurs');
      expect(result).toContain('- Has a dog named Max');
      expect(result).toContain('### Relationships:');
      expect(result).toContain('- user has_pet Max');
    });

    it('should return empty string for no memories', () => {
      expect(mem0Service.formatForPrompt(null)).toBe('');
      expect(mem0Service.formatForPrompt({ memories: [] })).toBe('');
      expect(mem0Service.formatForPrompt({})).toBe('');
    });

    it('should handle memories without relations', () => {
      const memoryData = {
        memories: ['Single memory'],
        relations: [],
        entities: []
      };

      const result = mem0Service.formatForPrompt(memoryData);

      expect(result).toContain('- Single memory');
      expect(result).not.toContain('Relationships');
    });
  });

  describe('getClient', () => {
    it('should return client config when configured', () => {
      const client = mem0Service.getClient();
      expect(client).toBeDefined();
      expect(client.baseURL).toBe('https://api.mem0.ai/v1');
      expect(client.headers.Authorization).toBe('Token test-api-key');
    });

    it('should return null when not configured', () => {
      jest.resetModules();
      delete process.env.MEM0_API_KEY;
      const freshService = require('../../src/services/integrations/mem0.service');

      const client = freshService.getClient();
      expect(client).toBeNull();
    });

    it('should return same client instance on multiple calls', () => {
      const client1 = mem0Service.getClient();
      const client2 = mem0Service.getClient();
      expect(client1).toBe(client2);
    });
  });

  describe('resetClient', () => {
    it('should reset the client instance', () => {
      const client1 = mem0Service.getClient();
      expect(client1).not.toBeNull();

      mem0Service.resetClient();

      // After reset, getClient should create a new instance
      const client2 = mem0Service.getClient();
      expect(client2).not.toBe(client1);
    });
  });

  describe('Constants', () => {
    it('should export MEM0_MEMORY_LIMIT', () => {
      expect(mem0Service.MEM0_MEMORY_LIMIT).toBe(20);
    });

    it('should export MEM0_TIMEOUT_MS', () => {
      expect(mem0Service.MEM0_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('URL normalization', () => {
    it('should remove trailing slashes from API URL', () => {
      jest.resetModules();
      process.env.MEM0_API_KEY = 'test-key';
      process.env.MEM0_API_URL = 'https://api.mem0.ai/v1/';

      const freshService = require('../../src/services/integrations/mem0.service');
      const client = freshService.getClient();

      expect(client.baseURL).toBe('https://api.mem0.ai/v1');
    });

    it('should remove /memories suffix from API URL', () => {
      jest.resetModules();
      process.env.MEM0_API_KEY = 'test-key';
      process.env.MEM0_API_URL = 'https://api.mem0.ai/v1/memories/';

      const freshService = require('../../src/services/integrations/mem0.service');
      const client = freshService.getClient();

      expect(client.baseURL).toBe('https://api.mem0.ai/v1');
    });
  });
});
