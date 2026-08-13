const PDFDocument = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument({ margin: 50 });
doc.pipe(fs.createWriteStream('presentation.pdf'));

doc.fontSize(24).font('Helvetica-Bold').text('LEDGR', { align: 'center' });
doc.fontSize(14).font('Helvetica').text('The Future of Retail Finance Management', { align: 'center' });
doc.moveDown(2);

// 1. Executive Summary
doc.fontSize(18).font('Helvetica-Bold').text('1. Executive Summary');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text(
  'LEDGR is a modern, comprehensive finance management platform tailored specifically for retail businesses (boutiques, supermarkets, minimarts, etc.). It addresses the common pain points of manual bookkeeping, disjointed payroll systems, and opaque financial forecasting.\n\nBy integrating core accounting, employee management, automated billing, and predictive analytics into one intuitive dashboard, LEDGR empowers business owners to make data-driven decisions and streamline their daily operations.'
);
doc.moveDown(2);

// 2. The Problem We Solve
doc.fontSize(18).font('Helvetica-Bold').text('2. The Problem We Solve');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text(
  'Retail business owners often juggle multiple systems or rely on error-prone spreadsheets for:\n' +
  '- Tracking daily sales and expenses.\n' +
  '- Managing staff payroll, taxes, and departments.\n' +
  '- Following up on customer payments.\n' +
  '- Projecting future cash flows.\n\n' +
  'This fragmentation leads to wasted time, lost revenue, and poor financial visibility.'
);
doc.moveDown(2);

// 3. Core Value Proposition
doc.fontSize(18).font('Helvetica-Bold').text('3. Core Value Proposition');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text(
  'LEDGR offers a single source of truth for retail operations. Our platform:\n' +
  '- Saves Time: Automates routine tasks like payroll calculation and savings allocations.\n' +
  '- Increases Visibility: Provides real-time insights into P&L and financial health.\n' +
  '- Reduces Errors: Replaces manual ledgers with secure, digital record-keeping.\n' +
  '- Enables Growth: Uses AI-powered forecasting to help businesses plan ahead.'
);
doc.moveDown(2);

doc.addPage();

// 4. Key Features
doc.fontSize(18).font('Helvetica-Bold').text('4. Key Features');
doc.moveDown(0.5);

doc.fontSize(14).font('Helvetica-Bold').text('Comprehensive Financial Tracking');
doc.fontSize(12).font('Helvetica').text(
  '- Income & Expenses: Effortlessly record and categorize daily transactions.\n' +
  '- Automated Billing (M-Pesa): Integrated M-Pesa callbacks to track mobile money payments seamlessly.\n' +
  '- Tax Management: Keep track of tax liabilities and easily mark them as paid.'
);
doc.moveDown(1);

doc.fontSize(14).font('Helvetica-Bold').text('Integrated Employee & Payroll Management');
doc.fontSize(12).font('Helvetica').text(
  '- HR Hub: Manage staff details, salaries, departments, and onboarding dates.\n' +
  '- Automated Payroll: Run bulk payroll, approve payments, and automatically generate downloadable PDF payslips for employees.'
);
doc.moveDown(1);

doc.fontSize(14).font('Helvetica-Bold').text('AI & Predictive Capabilities (Powered by Google Gemini)');
doc.fontSize(12).font('Helvetica').text(
  '- Revenue Forecasting: Analyze historical financial data to forecast future revenue and expenses.\n' +
  '- Financial Assistant: A built-in AI chatbot that users can consult directly from the app for financial advice or platform guidance.'
);
doc.moveDown(1);

doc.fontSize(14).font('Helvetica-Bold').text('Reporting & Analytics');
doc.fontSize(12).font('Helvetica').text(
  '- At-a-Glance Dashboard: A central hub showing quick financial summaries and key metrics.\n' +
  '- P&L Statements: Generate Profit & Loss statements and comprehensive financial reports instantly.'
);
doc.moveDown(2);

// 5. Technology Advantage
doc.fontSize(18).font('Helvetica-Bold').text('5. Technology Advantage');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text(
  'LEDGR is built on a robust, modern technology stack ensuring security, speed, and scalability:\n' +
  '- Backend: Node.js & Express.js for fast, event-driven processing.\n' +
  '- Database: PostgreSQL for reliable, relational data storage.\n' +
  '- Integrations: Google GenAI for predictive models and Africa\'s Talking for mobile integrations.\n' +
  '- Security: Enterprise-grade security practices including rate limiting, Helmet (CSP), and encrypted credentials.'
);

doc.end();
console.log('PDF generated successfully!');
