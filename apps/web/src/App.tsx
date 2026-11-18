import { lazy, Suspense, type ComponentType } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout, RequireRole } from "./layouts/AppLayout";
import { SessionProvider } from "./lib/session";
import { ErrorBoundary, Loading, Toaster } from "./components/ui";

/** Lazy-load one named page component from a module (keeps the first load small). */
const p = <M,>(f: () => Promise<M>, name: keyof M) =>
  lazy(async () => ({ default: (await f())[name] as unknown as ComponentType }));

/* Website & public pages */
const Home = p(() => import("./pages/site/SitePages"), "HomePage");
const Features = p(() => import("./pages/site/SitePages"), "FeaturesPage");
const Solutions = p(() => import("./pages/site/SitePages"), "SolutionsPage");
const Pricing = p(() => import("./pages/site/SitePages"), "PricingPage");
const Integrations = p(() => import("./pages/site/SitePages"), "IntegrationsPage");
const Contact = p(() => import("./pages/site/SitePages"), "ContactPage");
const Login = p(() => import("./pages/site/Auth"), "LoginPage");
const Signup = p(() => import("./pages/site/Auth"), "SignupPage");
const Proposal = p(() => import("./pages/public/PublicPages"), "ProposalPage");
const Store = p(() => import("./pages/public/PublicPages"), "StorePage");
const StorePackage = p(() => import("./pages/public/PublicPages"), "StorePackagePage");
const VisaTracker = p(() => import("./pages/public/PublicPages"), "VisaTrackerPage");
const Landing = p(() => import("./pages/public/PublicPages"), "LandingPage");
const PayPage = p(() => import("./pages/public/PayPage"), "PayPage");
const Portal = p(() => import("./pages/public/Plus"), "CustomerPortalPage");
const VisaUpload = p(() => import("./pages/public/Plus"), "VisaUploadPage");
const FlightsSite = p(() => import("./pages/public/Plus"), "FlightsSitePage");
const HotelsSite = p(() => import("./pages/public/Plus"), "HotelsSitePage");
const SeriesSite = p(() => import("./pages/public/Plus"), "SeriesSitePage");
const InsuranceSite = p(() => import("./pages/public/Plus"), "InsuranceSitePage");
const PrintInvoice = p(() => import("./pages/public/PrintPages"), "PrintInvoicePage");
const PrintVoucher = p(() => import("./pages/public/PrintPages"), "PrintVoucherPage");
const PrintQuote = p(() => import("./pages/public/PrintPages"), "PrintQuotePage");

/* Back office */
const Dashboard = p(() => import("./pages/app/Dashboard"), "DashboardPage");
const Onboarding = p(() => import("./pages/app/Onboarding"), "OnboardingPage");
const InboxPage = p(() => import("./pages/app/Inbox"), "InboxPage");
const Tasks = p(() => import("./pages/app/Tasks"), "TasksPage");
const Leads = p(() => import("./pages/app/Leads"), "LeadsPage");
const LeadDetail = p(() => import("./pages/app/Leads"), "LeadDetailPage");
const Quotes = p(() => import("./pages/app/Quotes"), "QuotesPage");
const QuoteBuilder = p(() => import("./pages/app/QuoteBuilder"), "QuoteBuilderPage");
const Contacts = p(() => import("./pages/app/Contacts"), "ContactsPage");
const CustomerDetail = p(() => import("./pages/app/Contacts"), "CustomerDetailPage");
const AiStudio = p(() => import("./pages/app/Plus"), "AiStudioPage");
const Calls = p(() => import("./pages/app/Plus"), "CallsPage");
const Engines = p(() => import("./pages/app/Plus"), "EnginesPage");
const Inventory = p(() => import("./pages/app/Plus"), "InventoryPage");
const Insurance = p(() => import("./pages/app/Plus"), "InsurancePage");
const Messages = p(() => import("./pages/app/Plus"), "MessagesPage");
const PaymentLinks = p(() => import("./pages/app/PaymentLinks"), "PaymentLinksPage");
const Automations = p(() => import("./pages/app/Automations"), "AutomationsPage");
const Approvals = p(() => import("./pages/app/Plus"), "ApprovalsPage");
const Bookings = p(() => import("./pages/app/Bookings"), "BookingsPage");
const BookingDetail = p(() => import("./pages/app/Bookings"), "BookingDetailPage");
const Operations = p(() => import("./pages/app/Operations"), "OperationsPage");
const Groups = p(() => import("./pages/app/Operations"), "GroupsPage");
const Resources = p(() => import("./pages/app/Operations"), "ResourcesPage");
const Finance = p(() => import("./pages/app/Finance"), "FinanceOverviewPage");
const Invoices = p(() => import("./pages/app/Finance"), "InvoicesPage");
const InvoiceDetail = p(() => import("./pages/app/Finance"), "InvoiceDetailPage");
const Payments = p(() => import("./pages/app/Finance"), "PaymentsPage");
const Payables = p(() => import("./pages/app/Finance"), "PayablesPage");
const Ledger = p(() => import("./pages/app/Finance"), "LedgerPage");
const Tax = p(() => import("./pages/app/Finance"), "TaxPage");
const Agents = p(() => import("./pages/app/B2B"), "AgentsPage");
const AgentDetail = p(() => import("./pages/app/B2B"), "AgentDetailPage");
const Visa = p(() => import("./pages/app/Visa"), "VisaPage");
const VisaDetail = p(() => import("./pages/app/Visa"), "VisaDetailPage");
const Marketing = p(() => import("./pages/app/Marketing"), "MarketingPage");
const Portals = p(() => import("./pages/app/Portals"), "PortalsPage");
const Masters = p(() => import("./pages/app/Masters"), "MastersPage");
const Reports = p(() => import("./pages/app/Reports"), "ReportsPage");
const Settings = p(() => import("./pages/app/Settings"), "SettingsPage");

/* Agent portal and field app */
const AgentPortal = p(() => import("./pages/agent/AgentPortal"), "AgentPortal");
const FieldApp = p(() => import("./pages/agent/FieldApp"), "FieldApp");

export function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <Toaster />
        <ErrorBoundary>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/features" element={<Features />} />
              <Route path="/solutions/:type" element={<Solutions />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              <Route path="/p/:tenantId/:token" element={<Proposal />} />
              <Route path="/store/:tenantId" element={<Store />} />
              <Route path="/store/:tenantId/package/:id" element={<StorePackage />} />
              <Route path="/visa-status/:tenantId" element={<VisaTracker />} />
              <Route path="/lp/:tenantId/:slug" element={<Landing />} />
              <Route path="/pay/:tenantId/:token" element={<PayPage />} />
              <Route path="/my/:tenantId" element={<Portal />} />
              <Route path="/visa-upload/:tenantId/:token" element={<VisaUpload />} />
              <Route path="/book/:tenantId/flights" element={<FlightsSite />} />
              <Route path="/book/:tenantId/hotels" element={<HotelsSite />} />
              <Route path="/book/:tenantId/series" element={<SeriesSite />} />
              <Route path="/book/:tenantId/insurance" element={<InsuranceSite />} />
              <Route path="/print/invoice/:id" element={<PrintInvoice />} />
              <Route path="/print/voucher/:id" element={<PrintVoucher />} />
              <Route path="/print/quote/:id" element={<PrintQuote />} />

              <Route path="/app" element={<AppLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="onboarding" element={<RequireRole roles={["owner", "admin"]}><Onboarding /></RequireRole>} />
                <Route path="inbox" element={<InboxPage />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="leads" element={<Leads />} />
                <Route path="leads/:id" element={<LeadDetail />} />
                <Route path="quotes" element={<Quotes />} />
                <Route path="quotes/:id" element={<QuoteBuilder />} />
                <Route path="contacts" element={<Contacts />} />
                <Route path="contacts/:id" element={<CustomerDetail />} />
                <Route path="ai" element={<AiStudio />} />
                <Route path="calls" element={<Calls />} />
                <Route path="engines" element={<Engines />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="insurance" element={<Insurance />} />
                <Route path="messages" element={<Messages />} />
                <Route path="approvals" element={<Approvals />} />
                <Route path="finance/links" element={<PaymentLinks />} />
                <Route path="bookings" element={<Bookings />} />
                <Route path="bookings/:id" element={<BookingDetail />} />
                <Route path="operations" element={<Operations />} />
                <Route path="operations/groups" element={<Groups />} />
                <Route path="resources" element={<Resources />} />
                <Route path="finance" element={<Finance />} />
                <Route path="finance/invoices" element={<Invoices />} />
                <Route path="finance/invoices/:id" element={<InvoiceDetail />} />
                <Route path="finance/payments" element={<Payments />} />
                <Route path="finance/payables" element={<Payables />} />
                <Route path="finance/ledger" element={<Ledger />} />
                <Route path="finance/tax" element={<Tax />} />
                <Route path="b2b" element={<Agents />} />
                <Route path="b2b/:id" element={<AgentDetail />} />
                <Route path="visa" element={<Visa />} />
                <Route path="visa/:id" element={<VisaDetail />} />
                <Route path="marketing" element={<Marketing />} />
                <Route path="automations" element={<Automations />} />
                <Route path="portals" element={<Portals />} />
                <Route path="masters" element={<Masters />} />
                <Route path="reports" element={<RequireRole roles={["owner", "admin", "accounts"]}><Reports /></RequireRole>} />
                <Route path="settings" element={<RequireRole roles={["owner", "admin"]}><Settings /></RequireRole>} />
                <Route path="*" element={<Navigate to="/app" replace />} />
              </Route>

              <Route path="/agent/*" element={<AgentPortal />} />
              <Route path="/field" element={<FieldApp />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </SessionProvider>
    </HashRouter>
  );
}
