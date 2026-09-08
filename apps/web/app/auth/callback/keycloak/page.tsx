'use client'

import React, { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { useAuth, validateOAuthState } from '@components/Contexts/AuthContext'
import { getLEARNHOUSE_DOMAIN_VAL, getLEARNHOUSE_TOP_DOMAIN_VAL, getAPIUrl } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'

export default function KeycloakCallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'csrf_error'>('loading')

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code')
      const state = searchParams.get('state')
      const errorParam = searchParams.get('error')

      // Handle OAuth errors from Keycloak
      if (errorParam) {
        setError(`Keycloak authentication failed: ${errorParam}`)
        setStatus('error')
        return
      }

      if (!code) {
        setError('No authorization code received from Keycloak')
        setStatus('error')
        return
      }

      if (!state) {
        setError('Missing state parameter - potential security issue')
        setStatus('csrf_error')
        return
      }

      try {
        const stateData = JSON.parse(atob(state))
        let bounceOrigin: string | null = null
        if (typeof stateData.returnOrigin === 'string') {
          try {
            const u = new URL(stateData.returnOrigin)
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              const host = u.hostname
              const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL()
              const isPlatformHost = !!topDomain && (host === topDomain || host.endsWith(`.${topDomain}`))
              if (isPlatformHost) {
                bounceOrigin = u.origin
              }
            }
          } catch {
            /* ignore */
          }
        }
        if (bounceOrigin && bounceOrigin !== window.location.origin) {
          const bounceUrl = new URL('/auth/callback/keycloak', bounceOrigin)
          searchParams.forEach((value, key) => {
            bounceUrl.searchParams.set(key, value)
          })
          window.location.href = bounceUrl.toString()
          return
        }
      } catch {
        /* state parse failed, fall through to CSRF */
      }

      const stateValidation = validateOAuthState(state)
      if (!stateValidation.valid) {
        setError('Invalid or expired authentication request. Please try again.')
        setStatus('csrf_error')
        return
      }

      const callbackUrl = stateValidation.callbackUrl || '/'

      let orgId: number | undefined
      let inviteCode: string | undefined
      try {
        const cookies = document.cookie.split(';')
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=')
          if (name === 'LH_oauth_org_id' && value) {
            orgId = parseInt(value, 10)
            if (isNaN(orgId)) {
              orgId = undefined
            }
          } else if (name === 'LH_oauth_invite_code' && value) {
            inviteCode = decodeURIComponent(value)
          }
        }
      } catch {
        // Ignore cookie parsing errors
      }

      try {
        const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL()
        const domainAttr = topDomain && topDomain !== 'localhost' ? `; domain=.${topDomain}` : ''
        for (const n of ['LH_oauth_org_id', 'LH_oauth_orgslug', 'LH_oauth_invite_code']) {
          document.cookie = `${n}=; path=/; max-age=0`
          if (domainAttr) document.cookie = `${n}=; path=/; max-age=0${domainAttr}`
        }
      } catch {
        // cleanup
      }

      try {
        const domain = getLEARNHOUSE_DOMAIN_VAL()
        const oauthRedirectUri = `${window.location.protocol}//${domain}/auth/callback/keycloak`

        // Exchange code for tokens
        const tokenResponse = await fetch('/api/auth/keycloak/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            redirect_uri: oauthRedirectUri,
          }),
        })

        if (!tokenResponse.ok) {
          const err = await tokenResponse.json().catch(() => ({}))
          throw new Error(typeof err.error === 'string' && err.error ? err.error : getErrorMessage(err.detail, 'Failed to exchange Keycloak authorization code.'))
        }

        const tokenData = await tokenResponse.json()
        if (!tokenData.access_token) {
          throw new Error('Invalid token response from Keycloak')
        }

        // Send to backend OAuth endpoint
        const oauthParams = new URLSearchParams()
        if (orgId) oauthParams.set('org_id', String(orgId))
        if (orgId && inviteCode) oauthParams.set('invite_code', inviteCode)
        const oauthUrl = oauthParams.toString()
          ? `/api/auth/oauth?${oauthParams.toString()}`
          : '/api/auth/oauth'

        const oauthResponse = await fetch(oauthUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: 'keycloak',
            access_token: tokenData.access_token,
          }),
          credentials: 'include',
        })

        if (!oauthResponse.ok) {
          const errorData = await oauthResponse.json().catch(() => ({}))
          throw new Error(getErrorMessage(errorData.detail, 'Failed to authenticate with Keycloak'))
        }

        const data = await oauthResponse.json()

        if (data.mfa_required && data.mfa_token) {
          const mfaParams = new URLSearchParams({ mfa_token: data.mfa_token })
          const next = new URLSearchParams(window.location.search).get('next')
          if (next && /^\/(?!\/)/.test(next)) mfaParams.set('redirect_to', next)
          router.push(`/auth/login?${mfaParams.toString()}`)
          return
        }

        if (!data.tokens?.access_token) {
          throw new Error('Invalid response from server')
        }

        const result = await signIn('credentials', {
          redirect: false,
          sso: 'true',
          sso_access_token: data.tokens.access_token,
          sso_refresh_token: data.tokens.refresh_token,
          sso_user: JSON.stringify(data.user),
          sso_expiry: data.tokens.expiry,
          callbackUrl,
        })

        if (result && !result.ok) {
          throw new Error(result.error || 'Failed to complete sign in')
        }

        setStatus('success')
        router.push(callbackUrl)
      } catch (err: any) {
        console.error('Keycloak callback processing error:', err)
        setError(err.message || 'An error occurred during authentication')
        setStatus('error')
      }
    }

    handleCallback()
  }, [searchParams, router, signIn])

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-zinc-800 rounded-xl shadow-lg p-6 text-center">
        {status === 'loading' && (
          <div className="py-8">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              Authenticating with Keycloak SSO...
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Please wait while we complete your sign-in.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="py-8">
            <div className="w-8 h-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              ✓
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              Sign-in successful!
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Redirecting you to the app...
            </p>
          </div>
        )}

        {(status === 'error' || status === 'csrf_error') && (
          <div className="py-6">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              {status === 'csrf_error' ? (
                <ShieldAlert className="w-6 h-6" />
              ) : (
                <AlertTriangle className="w-6 h-6" />
              )}
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              {status === 'csrf_error' ? 'Security Verification Failed' : 'Authentication Failed'}
            </h2>
            <p className="text-sm text-red-600 dark:text-red-400 mb-6">
              {error}
            </p>
            <Link
              href="/auth/login"
              className="inline-block w-full py-2.5 px-4 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            >
              Back to Login
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
