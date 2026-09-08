import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, redirect_uri } = body

    if (!code || !redirect_uri) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    try {
      const ru = new URL(redirect_uri)
      if ((ru.protocol !== 'http:' && ru.protocol !== 'https:') || ru.pathname !== '/auth/callback/keycloak') {
        return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 })
    }

    const keycloakInternal = (process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak.keycloak.svc.cluster.local/keycloak').replace(/\/+$/, '')
    const keycloakUrl = (process.env.KEYCLOAK_URL || 'https://vgurukool.com/keycloak').replace(/\/+$/, '')
    const realm = process.env.KEYCLOAK_REALM || 'cnoe'
    const clientId = process.env.KEYCLOAK_CLIENT_ID || 'vgurukool-apps'
    const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET || ''

    const params: Record<string, string> = {
      code,
      client_id: clientId,
      redirect_uri,
      grant_type: 'authorization_code',
    }
    if (clientSecret) {
      params.client_secret = clientSecret
    }

    let tokenResponse: Response | null = null
    // Try internal URL first, then fallback to public URL
    const tokenEndpoints = [
      `${keycloakInternal}/realms/${realm}/protocol/openid-connect/token`,
      `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`,
    ]

    for (const endpoint of tokenEndpoints) {
      try {
        tokenResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(params),
        })
        if (tokenResponse.ok) break
      } catch (err) {
        console.warn(`Failed token exchange via ${endpoint}:`, err)
      }
    }

    if (!tokenResponse || !tokenResponse.ok) {
      const errorData = tokenResponse ? await tokenResponse.json().catch(() => ({})) : {}
      console.error('Keycloak token exchange failed:', errorData)
      return NextResponse.json(
        { error: errorData.error_description || errorData.error || 'Token exchange failed' },
        { status: tokenResponse?.status || 500 }
      )
    }

    const tokenData = await tokenResponse.json()

    return NextResponse.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      id_token: tokenData.id_token,
    })
  } catch (error: any) {
    console.error('Keycloak token exchange error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
