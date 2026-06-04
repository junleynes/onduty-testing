# OnDuty - Modern Duty Scheduling Application

A comprehensive scheduling and shift management application built with Next.js, React, Tailwind CSS, and SQLite. Streamline your team's duty scheduling with drag-and-drop functionality, AI-powered assistance, and automated reporting.

## 📋 Table of Contents
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Installation Instructions](#installation-instructions)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Default Credentials](#default-credentials)
- [Database Management](#database-management)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

### Core Scheduling
- **Drag-and-Drop Interface**: Intuitive schedule creation with drag-and-drop functionality
- **Shift Templates**: Create and reuse shift templates for common scheduling patterns
- **Recurring Shifts**: Automatically schedule repeating shifts (daily, weekly, monthly)
- **Real-time Conflict Detection**: Automatic identification of scheduling conflicts
- **Multi-View Calendar**: Day, week, and month views for flexible planning

### Time Off Management
- **Leave Requests**: Submit and approve time-off requests with history tracking
- **Offsets & Comp Time**: Track and manage time offsets and compensatory time
- **Work Extensions**: Handle overtime and work extension requests
- **ALAF PDF Generation**: Automated generation of ALAF (Aviso de Liberação de Antecipação de Férias) documents
- **Leave Balance Tracking**: Real-time tracking of available leave balances

### Reporting & Analytics
- **Work Schedules**: Generate detailed work schedule reports
- **Attendance Sheets**: Create daily, weekly, and monthly attendance records
- **User Summaries**: Individual performance and attendance summaries
- **Tardiness Reports**: Track and report late arrivals and early departures
- **Export Options**: Export reports to PDF, Excel, and CSV formats

### Team Management
- **Role-Based Access**: Three user roles with granular permissions
  - **Admin**: Full system access and configuration
  - **Manager**: Schedule creation, approval powers, team oversight
  - **Member**: View schedules, submit requests, personal management
- **Group Assignments**: Organize users into teams and departments
- **Organizational Charts**: Visual representation of team structure
- **User Profiles**: Customizable user profiles with contact information

### AI-Powered Features
- **Smart Scheduling**: AI-assisted scheduling constraint resolution using Google Genkit
- **Optimization Suggestions**: Automated recommendations for schedule improvements
- **Pattern Recognition**: Identifies scheduling patterns and optimization opportunities
- **Predictive Analytics**: Forecasts staffing needs based on historical data

### Additional Features
- **Mobile Responsive**: Fully responsive design for desktop, tablet, and mobile devices
- **Real-time Notifications**: Email and in-app notifications for schedule changes
- **Calendar Integration**: Export schedules to Google Calendar, Outlook, and iCal
- **Audit Logging**: Complete audit trail of all schedule changes and user actions
- **Bulk Operations**: Mass assign shifts, approve requests, and update schedules
- **Custom Fields**: Add custom data fields to shifts, users, and schedules

## 🛠️ Technology Stack

| Category | Technologies |
|----------|--------------|
| **Frontend** | Next.js 14, React 18, Tailwind CSS |
| **Backend** | Next.js API Routes, NextAuth.js |
| **Database** | SQLite (local.db), Prisma ORM |
| **AI/ML** | Google Genkit, Gemini API |
| **Authentication** | NextAuth.js v5 (beta) |
| **PDF Generation** | Custom PDF engine for ALAF documents |
| **Language** | TypeScript (95.5%) |
| **Development** | Node.js, npm, Firebase Studio |

## 📋 Prerequisites

Before installing, ensure you have the following:

- **Node.js**: Version 18.0 or higher
  ```bash
  node --version  # Should show v18.0.0 or higher
