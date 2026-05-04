import { motion } from 'framer-motion'
import { forwardRef } from 'react'

const Card = forwardRef(({ 
  children, 
  className = '',
  hover = false,
  interactive = false,
  ...props 
}, ref) => {
  const baseClasses = 'card'
  const hoverClasses = hover ? 'card-hover' : ''
  const interactiveClasses = interactive ? 'card-interactive' : ''
  
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`${baseClasses} ${hoverClasses} ${interactiveClasses} ${className}`}
      {...props}
    >
      {children}
    </motion.div>
  )
})

Card.displayName = 'Card'

const CardHeader = forwardRef(({ children, className = '', ...props }, ref) => (
  <div ref={ref} className={`mb-4 ${className}`} {...props}>
    {children}
  </div>
))

CardHeader.displayName = 'CardHeader'

const CardTitle = forwardRef(({ children, className = '', ...props }, ref) => (
  <h3 ref={ref} className={`text-xl font-bold text-gray-900 ${className}`} {...props}>
    {children}
  </h3>
))

CardTitle.displayName = 'CardTitle'

const CardBody = forwardRef(({ children, className = '', ...props }, ref) => (
  <div ref={ref} className={className} {...props}>
    {children}
  </div>
))

CardBody.displayName = 'CardBody'

Card.Header = CardHeader
Card.Title = CardTitle
Card.Body = CardBody

export default Card
