import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import RecipientInfoPage from './pages/RecipientInfoPage'
import ABCAnalysisPage from './pages/ABCAnalysisPage'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/recipient-info" element={<RecipientInfoPage />} />
        <Route
          path="/abc-analysis"
          element={
            <ABCAnalysisPage
              pageTitle="Báo Cáo Doanh Số Nội Thất"
              variantTag="Furniture Stock"
            />
          }
        />
        <Route
          path="/abc-analysis/stock-fabrics"
          element={
            <ABCAnalysisPage
              pageTitle="Báo Cáo Doanh Số Vải"
              variantTag="Stock fabrics"
            />
          }
        />
      </Routes>
    </Router>
  )
}

export default App
