'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Zap,
  Plug2,
  Phone,
  BookOpen,
  MessageSquare,
  ChevronUp,
  LogOut,
  Settings,
  LayoutDashboard,
} from 'lucide-react'
import type { User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'
import { APP_NAME } from '@/lib/config'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/', active: true },
  { icon: Phone, label: 'Phone', href: '/phone', active: true },
  { icon: Zap, label: 'Tools', href: '/tools', active: true },
  { icon: BookOpen, label: 'Knowledge', href: '/knowledge', active: true },
  { icon: Plug2, label: 'Integrations', href: '/integrations', active: true },
  { icon: MessageSquare, label: 'Chat', href: '/chat', active: true },
]

function getInitials(user: User): string {
  const fullName = user.user_metadata?.full_name as string | undefined
  if (fullName) {
    const words = fullName.trim().split(/\s+/)
    if (words.length >= 2) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase()
    }
    if (words[0]) {
      return words[0][0].toUpperCase()
    }
  }
  if (user.email) {
    return user.email[0].toUpperCase()
  }
  return 'U'
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '…'
}

interface AppSidebarProps {
  user: User
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const displayName =
    truncate((user.user_metadata?.full_name as string | undefined) ?? user.email ?? '', 24)
  const email = user.email ?? ''
  const initials = getInitials(user)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold tracking-tight">{APP_NAME}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary leading-tight">
            beta
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon
                const isChatItem = item.href === '/chat'
                const isPhoneItem = item.href === '/phone'
                const isCurrentPage =
                  pathname === item.href ||
                  pathname.startsWith(item.href + '/') ||
                  (isChatItem && pathname === '/widget') ||
                  (isPhoneItem && (
                    pathname.startsWith('/calls') ||
                    pathname.startsWith('/outbound') ||
                    pathname.startsWith('/assistants')
                  ))

                if (!item.active) {
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        disabled
                        className="opacity-40 cursor-not-allowed"
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                }

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isCurrentPage}
                      data-active={isCurrentPage}
                    >
                      <Link href={item.href}>
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full px-2 py-2 rounded-md hover:bg-sidebar-accent transition-colors text-left">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[13px] font-medium leading-tight truncate">
                  {displayName}
                </span>
                {email && (
                  <span className="text-[11px] text-muted-foreground leading-tight truncate">
                    {email}
                  </span>
                )}
              </div>
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[--radix-dropdown-menu-trigger-width]">
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link href="/organizations">
                <Settings className="h-4 w-4 mr-2" />
                Manage Organizations
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
