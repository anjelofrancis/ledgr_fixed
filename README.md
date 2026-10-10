# LEDGR - Finance Management Platform for Retail Businesses

LEDGR is a comprehensive, modern finance management platform tailored for retail businesses (boutiques, supermarkets, and more). It simplifies tracking income, expenses, employee payroll, and taxes while offering predictive analytics and automated savings features. 

Built with a robust Node.js and Express backend, PostgreSQL database, and integrated with powerful third-party services like Africa's Talking for SMS/USSD and Google GenAI for predictive features.

## 🚀 Features

### Core Modules
* **Dashboard:** A central hub showing a quick summary of finances, recent transactions, and key metrics.
* **Authentication & Authorization:** Secure login/register system with role-based access control (`admin`, `manager`, `staff`). Includes rate limiting to prevent brute force attacks.
* **Income & Expense Tracking:** Effortlessly record and categorize daily income and expenses.
* **Employee Management:** Manage staff details, salaries, departments, and onboarding dates.
* **Payroll Processing:** Automate payroll runs and generate downloadable PDF payslips.
* **Tax Management:** Keep track of tax liabilities and mark them as paid.
* **Automated Billing:** Integrated M-Pesa callbacks to track customer payments seamlessly.

### Advanced Features
* **Predictive Analytics (Forecast):** Leverages Google Gemini AI to analyze your past financial data and forecast future revenue/expenses.
* **Automated Savings:** Set business saving goals and automatically compute required allocations.
* **Reporting & Statements:** Generate P&L (Profit & Loss) statements and comprehensive financial reports as downloadable PDFs.
* **AI Chat Assistant:** A built-in AI chatbot available for users to query financial concepts directly from the app.
* **Business Settings:** Manage your store details, invite team members, and toggle user access securely.

## 🛠️ Technology Stack

* **Backend:** Node.js, Express.js
* **Database:** PostgreSQL (with `pg` module)
* **Templating Engine:** EJS
* **Security:** Helmet, CORS, Express-Rate-Limit, BCrypt.js
* **Integrations:** 
  * `@google/genai` (For predictive forecasting and chatbot)
  * `africastalking` (For SMS/USSD functionality)
* **Utilities:**
  * `multer` (File uploads)
  * `pdfkit` (PDF generation for payslips/reports)
  * `nodemailer` (Email notifications)
  * `node-cron` (Background tasks/cron jobs)
  * `simple-statistics` (Data analysis utilities)

## ⚙️ Getting Started

### Prerequisites

Ensure you have the following installed:
* Node.js (v18.0.0 or higher)
* PostgreSQL Database

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository_url>
   cd ledgr_fixed
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   * Copy the `.env.example` file to create your own `.env` file:
     ```bash
     cp .env.example .env
     ```
   * Open `.env` and fill in your database credentials, Google Gemini API key, Africa's Talking API keys, and other required secrets.

4. **Database Setup:**
   Run the migration script to set up the necessary PostgreSQL tables:
   ```bash
   npm run migrate
   ```
   *Optional:* Run the seed script to populate your database with dummy data for testing:
   ```bash
   npm run seed
   ```

5. **Start the Application:**
   * For development (with auto-reload via nodemon):
     ```bash
     npm run dev
     ```
   * For production:
     ```bash
     npm start
     ```

6. **Access the App:**
   Open your browser and navigate to `http://localhost:3000` (or the port specified in your `.env` file).

7. **Managing subscriptions (operators):**
   New businesses start on a 14-day Pro trial and fall back to Free when it ends. After a customer pays, activate their plan:
   ```bash
   npm run set-plan -- shop@example.com pro 12   # Pro for 12 months
   npm run set-plan -- shop@example.com cancel   # stop renewing; access continues to the paid-through date
   ```

## 🗂️ Project Structure

```
├── .env.example         # Environment variables template
├── config/              # Configuration files
├── migrations/          # Database schema migrations and seed scripts
├── scripts/             # Operator tools (e.g. set-plan)
├── src/                 # Application source code
│   ├── app.js           # Express app initialization & middleware setup
│   ├── controllers/     # Route logic for different modules (auth, expenses, etc.)
│   ├── middleware/      # Custom middleware (auth checks, rate limiters)
│   ├── public/          # Static assets (CSS, JS, images)
│   ├── routes/          # Express route definitions
│   ├── utils/           # Helper functions (cron jobs, etc.)
│   └── views/           # EJS templates for the frontend
├── Dockerfile           # Docker configuration for containerization
├── docker-compose.yml   # Docker Compose setup for easy deployment
└── package.json         # Node.js dependencies and scripts
```

## 🔒 Security Practices

* **Content Security Policy:** Configured via `helmet` to mitigate XSS attacks.
* **Rate Limiting:** Protects authentication endpoints (`/auth/login`, `/auth/register`) from brute force and limits general requests to prevent DDoS.
* **Cookie Security:** Secure parsing and signing using a secret key.
* **Environment Variables:** All sensitive keys (DB, APIs) are loaded securely from `.env`.

## 📜 License

This project is licensed under the MIT License.
