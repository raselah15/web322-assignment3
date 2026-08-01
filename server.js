/*
WEB322-Assignment 03
*
* I declare that this assignment is my own work in accordance with Seneca's
* Academic Integrity Policy:
* https://www.senecapolytechnic.ca/about/policies/academic-integrity-policy.html
*
* Name: Rasel Ahmmed
* Student ID: 182801233
* Date: July 29, 2026
*/

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const clientSessions = require('client-sessions');
const exphbs = require('express-handlebars');
require('dotenv').config();

const app = express();
const HTTP_PORT = process.env.PORT || 8080;

// ==========================================
// Database Setup
// ==========================================

// 1. MongoDB (Mongoose) for Users
mongoose.connect(process.env.MONGODB_URI);

const dbMongo = mongoose.connection;
dbMongo.on('error', (err) => console.error('MongoDB connection error:', err));
dbMongo.once('open', () => console.log('Connected to MongoDB'));

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model("User", userSchema);

// 2. PostgreSQL (Sequelize) for Tasks
const sequelize = new Sequelize(process.env.POSTGRES_URL, {
    dialect: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: false
});

const Task = sequelize.define('Task', {
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    dueDate: { type: DataTypes.DATE },
    status: { type: DataTypes.STRING, defaultValue: 'pending' },
    userId: { type: DataTypes.STRING, allowNull: false }
});

// ==========================================
// Middleware Configuration
// ==========================================

app.engine('.hbs', exphbs.engine({ 
    extname: '.hbs',
    helpers: {
        eq: (a, b) => a === b
    }
}));
app.set('view engine', '.hbs');

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(clientSessions({
    cookieName: 'session',
    secret: process.env.SESSION_SECRET || 'web322_assignment3_super_secret_key',
    duration: 30 * 60 * 1000, // 30 minutes
    activeDuration: 5 * 60 * 1000,
    httpOnly: true,
    secure: false
}));

// Expose session to views
app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});

// Authentication Middleware
function ensureLogin(req, res, next) {
    if (!req.session.user) {
        res.redirect('/login');
    } else {
        next();
    }
}

// ==========================================
// Authentication Routes (MongoDB)
// ==========================================

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.render('register', { error: 'All fields are required.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = new User({
            username,
            email,
            password: hashedPassword
        });

        await newUser.save();
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.render('register', { error: 'Username or email already exists or invalid data.' });
    }
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.render('login', { error: 'Missing username or password.' });
    }

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.render('login', { error: 'Invalid username or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid username or password.' });
        }

        req.session.user = {
            _id: user._id,
            username: user.username,
            email: user.email
        };

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'An error occurred during login.' });
    }
});

app.get('/logout', (req, res) => {
    req.session.reset();
    res.redirect('/login');
});

// ==========================================
// Task Routes (Protected - PostgreSQL)
// ==========================================

app.get('/dashboard', ensureLogin, async (req, res) => {
    try {
        const tasks = await Task.findAll({ where: { userId: req.session.user._id } });
        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(t => t.status === 'completed').length;
        const pendingTasks = totalTasks - completedTasks;

        res.render('dashboard', { 
            user: req.session.user, 
            totalTasks, 
            completedTasks, 
            pendingTasks 
        });
    } catch (err) {
        console.error(err);
        res.render('dashboard', { error: 'Failed to load dashboard data.' });
    }
});

app.get('/tasks', ensureLogin, async (req, res) => {
    try {
        const tasks = await Task.findAll({ 
            where: { userId: req.session.user._id },
            raw: true
        });
        res.render('tasks', { tasks });
    } catch (err) {
        console.error(err);
        res.render('tasks', { error: 'Failed to retrieve tasks.' });
    }
});

app.get('/tasks/add', ensureLogin, (req, res) => {
    res.render('addTask');
});

app.post('/tasks/add', ensureLogin, async (req, res) => {
    try {
        const { title, description, dueDate } = req.body;
        await Task.create({
            title,
            description,
            dueDate: dueDate ? new Date(dueDate) : null,
            status: 'pending',
            userId: req.session.user._id
        });
        res.redirect('/tasks');
    } catch (err) {
        console.error(err);
        res.render('addTask', { error: 'Failed to create task.' });
    }
});

app.get('/tasks/edit/:id', ensureLogin, async (req, res) => {
    try {
        const task = await Task.findOne({ 
            where: { id: req.params.id, userId: req.session.user._id },
            raw: true
        });
        if (!task) {
            return res.redirect('/tasks');
        }
        res.render('editTask', { task });
    } catch (err) {
        console.error(err);
        res.redirect('/tasks');
    }
});

app.post('/tasks/edit/:id', ensureLogin, async (req, res) => {
    try {
        const { title, description, dueDate, status } = req.body;
        await Task.update({
            title,
            description,
            dueDate: dueDate ? new Date(dueDate) : null,
            status: status ? 'completed' : 'pending'
        }, {
            where: { id: req.params.id, userId: req.session.user._id }
        });
        res.redirect('/tasks');
    } catch (err) {
        console.error(err);
        res.redirect('/tasks');
    }
});

app.post('/tasks/delete/:id', ensureLogin, async (req, res) => {
    try {
        await Task.destroy({
            where: { id: req.params.id, userId: req.session.user._id }
        });
        res.redirect('/tasks');
    } catch (err) {
        console.error(err);
        res.redirect('/tasks');
    }
});

app.post('/tasks/status/:id', ensureLogin, async (req, res) => {
    try {
        const task = await Task.findOne({ 
            where: { id: req.params.id, userId: req.session.user._id } 
        });
        if (task) {
            const newStatus = task.status === 'completed' ? 'pending' : 'completed';
            await task.update({ status: newStatus });
        }
        res.redirect('/tasks');
    } catch (err) {
        console.error(err);
        res.redirect('/tasks');
    }
});

// Default route
app.get('/', (req, res) => {
    res.redirect('/login');
});

// ==========================================
// Server Initialization & Database Sync
// ==========================================

sequelize.sync()
    .then(() => {
        console.log('PostgreSQL database synchronized.');
        app.listen(HTTP_PORT, () => {
            console.log(`Server listening on port ${HTTP_PORT}`);
        });
    })
    .catch((err) => {
        console.error('Failed to sync PostgreSQL database:', err);
    });

initializeApp();
module.exports = app;
