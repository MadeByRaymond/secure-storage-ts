import * as CryptoJS from 'crypto-es';

/**
 * Configuration Interface for `SecureStorage`
 */
export interface StorageConfig {
    /**
     * The secret key used for AES encryption.
     * If left blank, encryption is bypassed (disabled).
     */
    encryptionKey: string;
    /**
     * If true, bypasses encryption entirely when `isDev` is true.
     * @default false
     */
    disableInDev?: boolean;
    /**
     * Flags the environment as development.
     * If omitted, the service will auto-detect based on localhost or loopback IPs.
     */
    isDev?: boolean;
    /**
     * Explicitly set if the app is running in a browser environment.
     * If omitted, it defaults to checking `typeof window !== 'undefined'`.
     */
    isBrowser?: boolean;
    /**
     * A prefix appended to all storage keys to prevent collisions with other apps.
     * @default '__'
     */
    prefix?: string;
    /**
     * An array of exact storage keys that should always be forced into
     * `sessionStorage` instead of `localStorage`, overriding default behavior.
     *
     * Useful for keys you always need stored in the browser session storage
     * e.g: `PAYMENT_SESSION_INFORMATION`.
     *
     * Note that this is not the only way to use `sessionStorage`.
     * You can also pass into the `retrieve` and `store` methods, the param for `useSessionStorage`.
     */
    alwaysUseSessionStorageSet?: string[];
}

/**
 * @prop useSessionStorage - Set to `true` to save to `sessionStorage`.
 * @prop ttl - Time-to-live in milliseconds. Item will be deleted after this duration.
 */
interface StoreOptions {
    useSessionStorage?: boolean;
    ttl?: number;
}

export class SecureStorage {
    private readonly prefix: string;
    private readonly alwaysUseSessionStorageSet: string[];
    private readonly encryptionKey: string;
    private readonly disableInDev: boolean;
    private readonly isDev: boolean;
    private readonly isBrowser: boolean;
    private cachedKey: any;

    constructor(config: StorageConfig = {encryptionKey: ''}) {
        // Assign config values or safe defaults
        this.prefix = config?.prefix || '__';
        this.encryptionKey = config?.encryptionKey || '';
        this.isBrowser = config.isBrowser ?? typeof window !== 'undefined';

        this.isDev = config.isDev ?? (this.isBrowser ? (() => {
            const hostname = window.location.hostname;
            return (
                hostname === 'localhost' ||
                hostname === '[::1]' || // IPv6 localhost
                hostname.startsWith('127.') // Covers 127.0.0.1 and similar loopback IPs
            );
        })() : false);

        this.disableInDev = config.disableInDev || false;
        this.alwaysUseSessionStorageSet = config.alwaysUseSessionStorageSet || [];

        if (!this.encryptionKey) {
            console.warn('SecureStorage: Encryption key missing. Storage encryption has been disabled.');
        }
    }

    /**
     * Generates a 256-bit key using PBKDF2.
     * This is much more secure than using the raw string directly.
     */
    private getDerivedKey(salt:any) {
        return CryptoJS.PBKDF2(this.encryptionKey, salt, {
            keySize: 256 / 32,
            iterations: 1000 // Balance between security and performance
        });
    }

    // Encrypt data
    private encrypt(data: string): string {
        if ((this.isDev && this.disableInDev) || !this.encryptionKey) return data;

        // 1. Generate a fresh random Salt (16 bytes / 4 words)
        const salt = CryptoJS.WordArray.random(128 / 8);

        // 2. Generate a fresh random Initialization Vector (IV)
        const iv = CryptoJS.WordArray.random(128 / 8);

        // 3. Encrypt using the derived key and the random IV
        const encrypted = CryptoJS.AES.encrypt(data, this.getDerivedKey(salt), {
            iv: iv,
            mode: CryptoJS.CBC,
            padding: CryptoJS.Pkcs7
        });

        // 4. Combine Salt + IV + Ciphertext WordArrays and encode the whole block as Base64
        const combined = salt.concat(iv).concat(encrypted.ciphertext!);
        return combined.toString(CryptoJS.Base64);
    }

    // Decrypt data
    private decrypt(data: string): string | null {
        if ((this.isDev && this.disableInDev) || !this.encryptionKey) return data;
        if (!data) return null;

        try {
            // 1. Extract the Salt, IV and the ciphertext
            // 1a. Decode the combined Base64 string into a WordArray
            const combined = CryptoJS.Base64.parse(data);

            // 1b. Extract the Salt (first 16 bytes / 4 words)
            const salt = CryptoJS.WordArray.create(combined.words.slice(0, 4));

            // 1c. Extract the IV (next 16 bytes / 4 words)
            const iv = CryptoJS.WordArray.create(combined.words.slice(4, 8));

            // 1d. Extract everything else as the ciphertext
            const ciphertext = CryptoJS.WordArray.create(combined.words.slice(8));

            // 2. Decrypt using the same derived key and the extracted IV
            const bytes = CryptoJS.AES.decrypt({ ciphertext: ciphertext } as any, this.getDerivedKey(salt), {
                iv: iv,
                mode: CryptoJS.CBC,
                padding: CryptoJS.Pkcs7
            });

            const decrypted = bytes.toString(CryptoJS.Utf8);
            return decrypted || null;
        } catch (error) {
            console.error('SecureStorage: Decryption failed:', error);
            return null;
        }
    }

    /**
     * Encrypts and saves data into the browser's storage using an options object.
     * @param key - The unique identifier for the data.
     * @param value - The raw data or object to store.
     * @param options - Configuration object (useSessionStorage, ttl).
     */
    store(key: string, value: any, options?: StoreOptions): void;

    /**
     * Encrypts and saves data into the browser's storage using positional arguments.
     * @param key - The unique identifier for the data.
     * @param value - The raw data or object to store.
     * @param useSessionStorage - Set to `true` to save to `sessionStorage`.
     * @param ttl - Time-to-live in milliseconds. Item will be deleted after this duration.
     */
    store(key: string, value: any, useSessionStorage?: boolean, ttl?: number): void;

    /**
     * Encrypts and saves data into the browser's storage.
     */
    store(
        key: string,
        value: any,
        optionsOrUseSessionStorage?: boolean | StoreOptions,
        ttlArg?: number
    ): void {
        if (!this.isBrowser) return;

        let useSessionStorage = false;
        let ttl: number | undefined;

        // Detect which overload is being used
        if (typeof optionsOrUseSessionStorage === 'object' && optionsOrUseSessionStorage !== null) {
            useSessionStorage = !!optionsOrUseSessionStorage.useSessionStorage;
            ttl = optionsOrUseSessionStorage.ttl;
        } else {
            useSessionStorage = !!optionsOrUseSessionStorage;
            ttl = ttlArg;
        }

        const useSessionStore = useSessionStorage || this.alwaysUseSessionStorageSet.includes(key);
        const isObject = (typeof value === 'object' && value !== null);
        const isNotEncrypted = (this.isDev && this.disableInDev);

        // Create a storage envelope to hold the data and the encrypted expiry timestamp
        const envelope = {
            data: (!isObject || isNotEncrypted) ? value : JSON.stringify(value),
            expiry: ttl ? Date.now() + ttl : null,
            isObject
        };

        const encryptedValue = this.encrypt(JSON.stringify(envelope));
        const storage = useSessionStore ? sessionStorage : localStorage;

        storage.setItem(`${this.prefix}${key}`, encryptedValue);
    }

    /**
     * Retrieves and decrypts a value from the browser's storage.
     * @param key - The unique identifier of the stored data.
     * @param useSessionStorage - Set to `true` to force reading from `sessionStorage`. If `false`, it defaults to `localStorage` (unless the key is in `alwaysUseSessionStorageSet`).
     * @returns The decrypted string, the parsed JSON object, or `null` if the item doesn't exist or decryption fails.
     */
    retrieve(key: string, useSessionStorage: boolean = false): any {
        if (!this.isBrowser) return null;

        try {
            const useSessionStore = useSessionStorage || this.alwaysUseSessionStorageSet.includes(key);
            const storage = useSessionStore ? sessionStorage : localStorage;

            const encryptedValue = storage.getItem(`${this.prefix}${key}`);
            if (!encryptedValue) return null;

            const decryptedValue = this.decrypt(encryptedValue);
            if (!decryptedValue) return null;

            const envelope = JSON.parse(decryptedValue);

            // Check for expiry
            if (!!envelope?.expiry && (Date.now() > envelope.expiry)) {
                this.delete(key);
                return null;
            }

            const isNotEncrypted = (this.isDev && this.disableInDev);
            const isSavedAsRawValue = (isNotEncrypted || !(envelope?.isObject));

            const value = envelope.data;
            return isSavedAsRawValue ? value : JSON.parse(value || 'null');

        } catch (error) {
            console.error(error);
        }

        return null;
    }

    /**
     * Removes a specific item from both `localStorage` and `sessionStorage`.
     * @param key - The unique identifier of the data to remove (without the prefix).
     */
    delete(key: string): void {
        if (this.isBrowser) {
            localStorage.removeItem(`${this.prefix}${key}`);
            sessionStorage.removeItem(`${this.prefix}${key}`);
        }
    }

    /**
     * Scans all service-defined storage items and removes those that have expired.
     */
    clearExpired(): Promise<void> {
        return new Promise<void>(resolve => {
            if (!this.isBrowser) {
                resolve();
                return;
            }

            [localStorage, sessionStorage].forEach(storage => {
                Object.keys(storage).forEach(fullKey => {
                    if (fullKey.startsWith(this.prefix)) {
                        const keyWithoutPrefix = fullKey.replace(this.prefix, '');
                        // Calling retrieve() automatically handles the deletion logic if expired
                        this.retrieve(keyWithoutPrefix);
                    }
                });
            });
            resolve();
        });
    }

    /**
     * Removes all storage items from both `localStorage` and `sessionStorage`.
     *
     * It can be set to be specific to just `SecureStorage` service defined keys _only_,
     * or your entire application storage items.
     *
     * @param entireStorage - Choose if you want the entire local and session storage to be cleared.
     * Default is `false` so only keys defined by this service are removed/cleared.
     */
    clearAll(entireStorage: boolean = false): Promise<void> {
        return new Promise<void>(resolve => {
            if (!this.isBrowser) {
                resolve();
                return;
            }

            if (entireStorage) {
                localStorage.clear();
                sessionStorage.clear();
            } else {
                [localStorage, sessionStorage].forEach(storage => {
                    Object.keys(storage).forEach(key => {
                        if (key.startsWith(this.prefix)) {
                            storage.removeItem(key);
                        }
                    });
                });
            }
            resolve();
        });
    }
}
