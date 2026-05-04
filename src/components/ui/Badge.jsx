const Badge = ({ 
  children, 
  variant = 'primary',
  className = '',
  ...props 
}) => {
  const variants = {
    primary: 'badge-primary',
    success: 'badge-success',
    info: 'badge-info',
  }
  
  return (
    <span className={`${variants[variant]} ${className}`} {...props}>
      {children}
    </span>
  )
}

export default Badge
