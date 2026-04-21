/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SecureStorage } from './index';

describe('SecureStorage', () => {
    let storage: SecureStorage;

    // Run this before EVERY test to ensure a clean slate
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();

        // Initialize a new instance with a test key
        storage = new SecureStorage({
            encryptionKey: 'test-secret-key',
            prefix: 'TEST_',
            isDev: false // Force production mode so encryption actually runs
        });
    });

    // Clean up after tests
    afterEach(() => {
        vi.restoreAllMocks(); // Restore any mocked timers
    });

    it('should create an instance', () => {
        expect(storage).toBeInstanceOf(SecureStorage);
    });

    it('should encrypt data before saving to localStorage', () => {
        const testData = 'Sensitive User Data';
        storage.store('USER_DATA', testData);

        // Check the raw localStorage to ensure it's NOT plain text
        const rawStoredValue = localStorage.getItem('TEST_USER_DATA');

        expect(rawStoredValue).toBeTruthy();
        expect(rawStoredValue).not.toContain(testData); // Proves it was encrypted
    });

    it('should successfully retrieve and decrypt data', () => {
        storage.store('TOKEN', '12345-ABCDE');

        const retrieved = storage.retrieve('TOKEN');
        expect(retrieved).toBe('12345-ABCDE');
    });

    it('should store and automatically parse complex JSON objects', () => {
        const userObj = { name: 'Daniel', role: 'Admin' };
        storage.store('USER_OBJ', userObj);

        const retrieved = storage.retrieve('USER_OBJ');
        expect(retrieved).toEqual(userObj);
        expect(retrieved.name).toBe('Daniel');
    });

    it('should save to sessionStorage when specified', () => {
        storage.store('TEMP_DATA', 'SessionOnly', { useSessionStorage: true });

        expect(sessionStorage.getItem('TEST_TEMP_DATA')).toBeTruthy();
        expect(localStorage.getItem('TEST_TEMP_DATA')).toBeNull();
    });

    it('should handle TTL (Time-To-Live) expiration correctly', () => {
        // 1. Tell Vitest we want to control time
        vi.useFakeTimers();

        // 2. Store an item with a 5-second TTL
        storage.store('EXPIRES_SOON', 'ExpiringData', { ttl: 5000 });

        // 3. Immediately retrieve it (should exist)
        expect(storage.retrieve('EXPIRES_SOON')).toBe('ExpiringData');

        // 4. Fast-forward time by 6 seconds
        vi.advanceTimersByTime(6000);

        // 5. Retrieve it again (should be null and deleted from storage)
        expect(storage.retrieve('EXPIRES_SOON')).toBeNull();
        expect(localStorage.getItem('TEST_EXPIRES_SOON')).toBeNull();
    });

    it('should clear only service-defined keys using clearAll(false)', async () => {
        // Add external data not managed by the service
        localStorage.setItem('EXTERNAL_KEY', 'Do Not Delete Me');

        // Add service data
        storage.store('MY_KEY', 'Delete Me');

        await storage.clearAll(false);

        expect(storage.retrieve('MY_KEY')).toBeNull(); // Service data is gone
        expect(localStorage.getItem('EXTERNAL_KEY')).toBe('Do Not Delete Me'); // External data remains
    });
});
