const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection - Use Railway's environment variable
const MONGODB_URI = process.env.MONGO_URL || process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ MONGO_URL environment variable is required');
    process.exit(1);
}

let db;
let dbClient;

// Initialize MongoDB connection
async function connectToDatabase() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        dbClient = client;
        db = client.db();
        console.log('✅ Connected to MongoDB');
        
        // Initialize collections if they don't exist
        await initializeCollections();
        return true;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        return false;
    }
}

// Initialize collections with proper indexes
async function initializeCollections() {
    try {
        // Users collection
        await db.collection('users').createIndex({ id: 1 }, { unique: true });
        
        // Content collection
        await db.collection('content').createIndex({ id: 1 }, { unique: true });
        await db.collection('content').createIndex({ type: 1 });
        await db.collection('content').createIndex({ title: 'text', description: 'text' });
        
        // Chapters collection
        await db.collection('chapters').createIndex({ contentId: 1, chapterId: 1 }, { unique: true });
        
        // Ads config collection
        await db.collection('ads_config').createIndex({ id: 1 }, { unique: true });
        
        // Chapter locks collection with TTL index (auto-expire after 10 minutes)
        await db.collection('chapter_locks').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        
        // Uploads collection for storing images
        await db.collection('uploads').createIndex({ contentType: 1 });
        
        console.log('✅ Collections initialized');
    } catch (error) {
        console.error('❌ Error initializing collections:', error);
    }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
    const status = db ? 'healthy' : 'unhealthy';
    res.json({ 
        status, 
        database: db ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Serve uploaded images from MongoDB
app.get('/api/image/:id', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const image = await db.collection('uploads').findOne({ _id: new ObjectId(req.params.id) });
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }

        res.set('Content-Type', image.contentType);
        res.send(image.data.buffer);
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).json({ error: 'Failed to serve image' });
    }
});

// Upload image to MongoDB
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const uploadData = {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
            data: req.file.buffer,
            size: req.file.size,
            uploadedAt: new Date()
        };

        const result = await db.collection('uploads').insertOne(uploadData);
        
        res.json({ 
            success: true, 
            imageId: result.insertedId,
            url: `/api/image/${result.insertedId}`
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// API Routes
app.get('/api/data', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const content = await db.collection('content').find({}).toArray();
        res.json(content);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Get all manga/novel content
app.get('/api/manga', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const content = await db.collection('content').find({}).toArray();
        res.json(content);
    } catch (error) {
        console.error('Error fetching manga:', error);
        res.status(500).json({ error: 'Failed to fetch manga' });
    }
});

// Get specific manga/novel by ID
app.get('/api/manga/:id', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const content = await db.collection('content').findOne({ id: parseInt(req.params.id) });
        if (!content) {
            return res.status(404).json({ error: 'Content not found' });
        }
        res.json(content);
    } catch (error) {
        console.error('Error fetching manga:', error);
        res.status(500).json({ error: 'Failed to fetch manga' });
    }
});

// Create new manga/novel
app.post('/api/manga', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { title, description, type, cover, author, genres, status, rating, chapters_count } = req.body;
        
        // Generate a new ID
        const lastContent = await db.collection('content').find().sort({ id: -1 }).limit(1).toArray();
        const newId = lastContent.length > 0 ? lastContent[0].id + 1 : 1;
        
        const newContent = {
            id: newId,
            title,
            description,
            type: type || 'manga',
            cover,
            author: author || 'Unknown',
            genres: genres || 'Action, Adventure',
            status: status || 'Ongoing',
            rating: rating || '4.5',
            chapters_count: chapters_count || 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        await db.collection('content').insertOne(newContent);
        res.json(newContent);
    } catch (error) {
        console.error('Error creating manga:', error);
        res.status(500).json({ error: 'Failed to create manga' });
    }
});

// Update manga/novel
app.put('/api/manga/:id', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { title, description, cover, author, genres, status, rating } = req.body;
        
        const updateData = {
            ...(title && { title }),
            ...(description && { description }),
            ...(cover && { cover }),
            ...(author && { author }),
            ...(genres && { genres }),
            ...(status && { status }),
            ...(rating && { rating }),
            updated_at: new Date().toISOString()
        };
        
        const result = await db.collection('content').updateOne(
            { id: parseInt(req.params.id) },
            { $set: updateData }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Content not found' });
        }
        
        res.json({ success: true, message: 'Content updated successfully' });
    } catch (error) {
        console.error('Error updating manga:', error);
        res.status(500).json({ error: 'Failed to update manga' });
    }
});

// Get chapters for specific manga/novel
app.get('/api/manga/:id/chapters', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const chapters = await db.collection('chapters').find({ contentId: parseInt(req.params.id) }).toArray();
        
        // Convert to object format expected by frontend
        const chaptersObject = {};
        chapters.forEach(chapter => {
            chaptersObject[chapter.chapterId] = {
                title: chapter.title,
                pages: chapter.pages || [],
                content: chapter.content || null
            };
        });
        
        res.json(chaptersObject);
    } catch (error) {
        console.error('Error fetching chapters:', error);
        res.status(500).json({ error: 'Failed to fetch chapters' });
    }
});

// Create new chapter
app.post('/api/manga/:id/chapters', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { chapterId, title, pages, content } = req.body;
        const contentId = parseInt(req.params.id);
        
        // Check if chapter already exists
        const existingChapter = await db.collection('chapters').findOne({
            contentId: contentId,
            chapterId: chapterId
        });
        
        if (existingChapter) {
            return res.status(400).json({ error: 'Chapter already exists' });
        }
        
        const newChapter = {
            contentId: contentId,
            chapterId: chapterId,
            title: title || `Chapter ${chapterId}`,
            pages: pages || [],
            content: content || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        await db.collection('chapters').insertOne(newChapter);
        
        // Update chapter count in content
        await db.collection('content').updateOne(
            { id: contentId },
            { $inc: { chapters_count: 1 } }
        );
        
        res.json(newChapter);
    } catch (error) {
        console.error('Error creating chapter:', error);
        res.status(500).json({ error: 'Failed to create chapter' });
    }
});

// Delete chapter
app.delete('/api/manga/:id/chapters/:chapterId', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const result = await db.collection('chapters').deleteOne({
            contentId: parseInt(req.params.id),
            chapterId: req.params.chapterId
        });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Chapter not found' });
        }
        
        // Update chapter count in content
        await db.collection('content').updateOne(
            { id: parseInt(req.params.id) },
            { $inc: { chapters_count: -1 } }
        );
        
        res.json({ success: true, message: 'Chapter deleted successfully' });
    } catch (error) {
        console.error('Error deleting chapter:', error);
        res.status(500).json({ error: 'Failed to delete chapter' });
    }
});

// Delete manga/novel
app.delete('/api/manga/:id', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Delete the content
        const contentResult = await db.collection('content').deleteOne({ id: parseInt(req.params.id) });
        
        if (contentResult.deletedCount === 0) {
            return res.status(404).json({ error: 'Content not found' });
        }
        
        // Delete associated chapters
        await db.collection('chapters').deleteMany({ contentId: parseInt(req.params.id) });
        
        res.json({ success: true, message: 'Content and associated chapters deleted successfully' });
    } catch (error) {
        console.error('Error deleting content:', error);
        res.status(500).json({ error: 'Failed to delete content' });
    }
});

// Get ads config
app.get('/api/ads-config', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const adsConfig = await db.collection('ads_config').findOne({ id: 1 });
        if (!adsConfig) {
            // Return default config if none exists
            return res.json({
                enabled: true,
                adUnits: {
                    BANNER: 'ca-app-pub-3940256099942544/6300978111',
                    INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
                    REWARDED: 'ca-app-pub-3940256099942544/5224354917'
                },
                adFrequency: {
                    TAB_SWITCH: 0.3,
                    SCROLL_THRESHOLD: 1500,
                    INTERSTITIAL_COOLDOWN: 120000
                },
                rewardAdTimeout: 30000,
                chapterLockDuration: 600000, // 10 minutes
                debugMode: false
            });
        }
        res.json(adsConfig.config);
    } catch (error) {
        console.error('Error fetching ads config:', error);
        res.status(500).json({ error: 'Failed to fetch ads config' });
    }
});

// Update ads config
app.post('/api/ads-config', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const config = req.body;
        
        await db.collection('ads_config').updateOne(
            { id: 1 },
            { $set: { config: config, updated_at: new Date().toISOString() } },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Ads config updated successfully' });
    } catch (error) {
        console.error('Error updating ads config:', error);
        res.status(500).json({ error: 'Failed to update ads config' });
    }
});

// Create guest user
app.post('/api/guest-user', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Generate unique guest ID
        const guestId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const guestUser = {
            id: guestId,
            type: 'guest',
            created_at: new Date().toISOString(),
            last_seen: new Date().toISOString()
        };
        
        await db.collection('users').insertOne(guestUser);
        res.json({ user: guestUser });
    } catch (error) {
        console.error('Error creating guest user:', error);
        res.status(500).json({ error: 'Failed to create guest user' });
    }
});

// Get all users (admin only)
app.get('/api/users', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const users = await db.collection('users').find({}).toArray();
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Delete user
app.delete('/api/users/:id', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const result = await db.collection('users').deleteOne({ id: req.params.id });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Chapter lock management endpoints

// Check if chapter is unlocked
app.get('/api/check-unlock/:userId/:contentId/:chapterId', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { userId, contentId, chapterId } = req.params;
        
        const lock = await db.collection('chapter_locks').findOne({
            userId,
            contentId: parseInt(contentId),
            chapterId,
            expiresAt: { $gt: new Date() }
        });
        
        res.json({ unlocked: !!lock });
    } catch (error) {
        console.error('Error checking chapter lock:', error);
        res.status(500).json({ error: 'Failed to check chapter lock' });
    }
});

// Unlock chapter
app.post('/api/unlock-chapter', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { userId, contentId, chapterId } = req.body;
        
        if (!userId || !contentId || !chapterId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
        
        await db.collection('chapter_locks').updateOne(
            { userId, contentId: parseInt(contentId), chapterId },
            { 
                $set: { 
                    unlockedAt: new Date(),
                    expiresAt: expiresAt
                } 
            },
            { upsert: true }
        );
        
        // Update user last seen
        await db.collection('users').updateOne(
            { id: userId },
            { $set: { last_seen: new Date().toISOString() } }
        );
        
        res.json({ 
            success: true, 
            message: 'Chapter unlocked successfully',
            expiresAt: expiresAt.toISOString()
        });
    } catch (error) {
        console.error('Error unlocking chapter:', error);
        res.status(500).json({ error: 'Failed to unlock chapter' });
    }
});

// Refresh all chapter locks (reset all locks)
app.post('/api/refresh-chapter-locks', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Delete all chapter locks
        const result = await db.collection('chapter_locks').deleteMany({});
        
        res.json({ 
            success: true, 
            message: 'All chapter locks refreshed',
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Error refreshing chapter locks:', error);
        res.status(500).json({ error: 'Failed to refresh chapter locks' });
    }
});

// Get chapter lock status for user
app.get('/api/user-locks/:userId', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const locks = await db.collection('chapter_locks').find({
            userId: req.params.userId,
            expiresAt: { $gt: new Date() }
        }).toArray();
        
        res.json(locks);
    } catch (error) {
        console.error('Error fetching user locks:', error);
        res.status(500).json({ error: 'Failed to fetch user locks' });
    }
});

// Ad completion endpoint
app.post('/ads-complete', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { userId, manga, chapterId } = req.body;
        
        if (!userId || !manga || !chapterId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Unlock the chapter for 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        
        await db.collection('chapter_locks').updateOne(
            { userId, contentId: manga, chapterId },
            { 
                $set: { 
                    unlockedAt: new Date(),
                    expiresAt: expiresAt
                } 
            },
            { upsert: true }
        );
        
        // Update user last seen
        await db.collection('users').updateOne(
            { id: userId },
            { $set: { last_seen: new Date().toISOString() } }
        );
        
        res.json({ success: true, message: 'Ad completed and chapter unlocked' });
    } catch (error) {
        console.error('Error in ad completion:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Direct chapter access (for unlocked chapters)
app.get('/direct-chapter/:manga/:chapterId', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { manga, chapterId } = req.params;
        
        // Find the chapter data using normalized title
        const chapter = await db.collection('chapters').findOne({
            normalizedTitle: manga,
            chapterId: chapterId
        });
        
        if (chapter) {
            res.json({
                title: chapter.title,
                pages: chapter.pages || [],
                content: chapter.content || null
            });
        } else {
            res.status(404).json({ error: 'Chapter not found' });
        }
    } catch (error) {
        console.error('Error fetching chapter:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Chapter access with lock check
app.get('/chapter/:manga/:chapterId', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { manga, chapterId } = req.params;
        const userId = req.query.user || 'guest';
        
        // Check if the chapter is unlocked for this user
        const unlockRecord = await db.collection('chapter_locks').findOne({
            userId,
            contentId: manga,
            chapterId,
            expiresAt: { $gt: new Date() }
        });
        
        if (!unlockRecord) {
            return res.status(402).json({ error: 'Chapter locked. Please watch an ad to unlock.' });
        }
        
        // Find the chapter data
        const chapter = await db.collection('chapters').findOne({
            normalizedTitle: manga,
            chapterId: chapterId
        });
        
        if (chapter) {
            res.json({
                title: chapter.title,
                pages: chapter.pages || [],
                content: chapter.content || null
            });
        } else {
            res.status(404).json({ error: 'Chapter not found' });
        }
    } catch (error) {
        console.error('Error fetching chapter:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 40-second timer endpoint for chapter unlock simulation
app.post('/api/start-chapter-timer', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { userId, contentId, chapterId } = req.body;
        
        // Simulate 40-second timer
        setTimeout(async () => {
            try {
                const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
                
                await db.collection('chapter_locks').updateOne(
                    { userId, contentId: parseInt(contentId), chapterId },
                    { 
                        $set: { 
                            unlockedAt: new Date(),
                            expiresAt: expiresAt
                        } 
                    },
                    { upsert: true }
                );
                
                console.log(`Chapter ${contentId}-${chapterId} unlocked for user ${userId}`);
            } catch (error) {
                console.error('Error auto-unlocking chapter:', error);
            }
        }, 40000); // 40 seconds
        
        res.json({ 
            success: true, 
            message: 'Chapter unlock timer started (40 seconds)',
            timerDuration: 40000
        });
    } catch (error) {
        console.error('Error starting chapter timer:', error);
        res.status(500).json({ error: 'Failed to start chapter timer' });
    }
});

// Serve admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve main app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Initialize server
async function startServer() {
    console.log('🚀 Starting Rovel server...');
    
    // Attempt database connection with retries
    let connected = false;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!connected && attempts < maxAttempts) {
        connected = await connectToDatabase();
        if (!connected) {
            attempts++;
            console.log(`Retrying database connection (${attempts}/${maxAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    if (!connected) {
        console.error('❌ Failed to connect to MongoDB after multiple attempts');
        process.exit(1);
    }
    
    // Start the server
    app.listen(PORT, () => {
        console.log(`✅ Rovel server running on port ${PORT}`);
        console.log(`📖 Main app: http://localhost:${PORT}`);
        console.log(`⚙️  Admin panel: http://localhost:${PORT}/admin`);
        console.log(`❤️  Health check: http://localhost:${PORT}/health`);
    });
}

// Auto-refresh chapter locks every minute
setInterval(async () => {
    try {
        if (db) {
            const result = await db.collection('chapter_locks').deleteMany({
                expiresAt: { $lt: new Date() }
            });
            
            if (result.deletedCount > 0) {
                console.log(`Auto-cleaned ${result.deletedCount} expired chapter locks`);
            }
        }
    } catch (error) {
        console.error('Error auto-cleaning chapter locks:', error);
    }
}, 60000); // Check every minute

startServer().catch(console.error);