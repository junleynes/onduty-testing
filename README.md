# OnDuty - Modern Duty Scheduling

A comprehensive scheduling and shift management application built with Next.js, React, Tailwind CSS, and SQLite.

## Features

- **Shift Management:** Drag-and-drop scheduling, shift templates, and recurring shifts.
- **Time Off:** Leave requests, offsets, and work extensions with automated ALAF PDF generation.
- **Reporting:** Work schedules, attendance sheets, user summaries, and tardiness reports.
- **Team Management:** User roles (Admin, Manager, Member), group assignments, and organizational charts.
- **AI-Powered:** Smart scheduling constraint resolution using Genkit.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (installed automatically with Node.js)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd <project-folder>
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the root directory and add your Gemini API key for AI features:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

The application will be available at `http://localhost:9002`.

## Default Admin Credentials

Use these credentials to log in for the first time and configure your team:

- **Email:** `admin@onduty.local`
- **Password:** `P@ssw0rd`

## Database

The application uses a local SQLite database (`local.db`) which is automatically initialized when the server starts. You do not need to perform any manual database setup.
